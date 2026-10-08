/*
 * HTML to Video - Premiere Pro (ExtendScript) side.
 *
 * h2v_build(manifestPath, target) imports what the renderer produced:
 *   V1 (or the first new track) = background
 *   one track per object above it, each clip starting at the frame where
 *   the object first appears. "motion" objects are one still picture with
 *   Motion (Position / Scale / Rotation) and Opacity keyframes, so the
 *   animation stays fully editable in Premiere.
 *   <audio> files go on audio tracks at their start time.
 * target: 'new' = new sequence, 'active' = new tracks in the active
 * sequence, starting at the playhead.
 */

var H2V_TPS = 254016000000; // ticks per second

function h2v_pickFile() {
    var filter = ($.os.indexOf('Windows') >= 0) ? 'HTML files:*.html;*.htm' : function (f) {
        return (f instanceof Folder) || /\.html?$/i.test(f.name);
    };
    var f = File.openDialog('Select an HTML file', filter, false);
    return f ? f.fsName : '';
}

function h2v_readManifest(manifestPath) {
    var f = new File(manifestPath);
    if (!f.exists) throw new Error('Manifest not found: ' + manifestPath);
    f.encoding = 'UTF-8';
    f.open('r');
    var txt = f.read();
    f.close();
    // Written by our own renderer (plain JSON); ExtendScript has no JSON.parse.
    return eval('(' + txt + ')');
}

function h2v_ticks(ticks) {
    var t = new Time();
    t.ticks = String(Math.round(ticks));
    return t;
}

function h2v_frameTicks(frame, fps) {
    return frame * H2V_TPS / fps;
}

function h2v_nodeIds(bin) {
    var ids = {};
    for (var i = 0; i < bin.children.numItems; i++) ids[bin.children[i].nodeId] = true;
    return ids;
}

function h2v_import(file, bin, name, fps, numbered) {
    var before = h2v_nodeIds(bin);
    app.project.importFiles([file], true, bin, numbered);
    var item = null;
    for (var i = 0; i < bin.children.numItems; i++) {
        if (!before[bin.children[i].nodeId]) { item = bin.children[i]; break; }
    }
    if (!item) throw new Error('Could not import ' + file);
    try { item.name = name; } catch (e1) {}
    if (fps) {
        try { item.setOverrideFrameRate(fps); } catch (e2) {}
    }
    return item;
}

function h2v_addTracks(seq, video, audio) {
    if (video <= 0 && audio <= 0) return;
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    var v = seq.videoTracks.numTracks;
    var a = seq.audioTracks.numTracks;
    try {
        qeSeq.addTracks(video, v, audio, 1, a, 0, 0);
    } catch (e) {
        if (video > 0) qeSeq.addTracks(video, v, 0);
    }
}

function h2v_lastClip(track, item) {
    for (var i = track.clips.numItems - 1; i >= 0; i--) {
        var c = track.clips[i];
        if (c.projectItem && c.projectItem.nodeId === item.nodeId) return c;
    }
    return null;
}

/* ---------- keyframes ---------- */

function h2v_component(clip, matchName, displayName) {
    for (var i = 0; i < clip.components.numItems; i++) {
        var c = clip.components[i];
        if (c.matchName === matchName || c.displayName === displayName) return c;
    }
    return null;
}

function h2v_param(comp, displayName, index) {
    if (!comp) return null;
    for (var i = 0; i < comp.properties.numItems; i++) {
        if (comp.properties[i].displayName === displayName) return comp.properties[i];
    }
    return index < comp.properties.numItems ? comp.properties[index] : null;
}

// keys: [[frame, v1, v2...]] relative to the clip start
function h2v_keys(param, keys, value, clip, fps) {
    if (!param || !keys || !keys.length) return;
    var constant = true;
    for (var i = 1; i < keys.length && constant; i++) {
        for (var k = 1; k < keys[0].length; k++) {
            if (Math.abs(keys[i][k] - keys[0][k]) > 1e-6) constant = false;
        }
    }
    if (param.isTimeVarying()) param.setTimeVarying(false);
    if (constant) {
        param.setValue(value(keys[0]), true);
        return;
    }
    param.setTimeVarying(true);
    var inTicks = parseFloat(clip.inPoint.ticks);
    for (var j = 0; j < keys.length; j++) {
        var t = h2v_ticks(inTicks + h2v_frameTicks(keys[j][0], fps));
        param.addKey(t);
        param.setValueAtKey(t, value(keys[j]), j === keys.length - 1);
        try { param.setInterpolationTypeAtKey(t, 0, false); } catch (e) {} // 0 = linear
    }
}

function h2v_applyMotion(clip, L, m, place) {
    var motion = h2v_component(clip, 'AE.ADBE Motion', 'Motion');
    var opacity = h2v_component(clip, 'AE.ADBE Opacity', 'Opacity');
    var k = L.keys;
    var fps = m.fps;
    h2v_keys(h2v_param(motion, 'Position', 0), k.position, function (p) {
        return place(p[1], p[2]);
    }, clip, fps);
    if (!k.uniform) {
        var uniform = h2v_param(motion, 'Uniform Scale', 3);
        try { uniform.setValue(false, true); } catch (e) {}
        h2v_keys(h2v_param(motion, 'Scale Width', 2), k.scaleWidth, function (p) { return p[1]; }, clip, fps);
    }
    h2v_keys(h2v_param(motion, 'Scale', 1), k.scale, function (p) { return p[1]; }, clip, fps);
    h2v_keys(h2v_param(motion, 'Rotation', 4), k.rotation, function (p) { return p[1]; }, clip, fps);
    h2v_keys(h2v_param(opacity, 'Opacity', 0), k.opacity, function (p) { return p[1]; }, clip, fps);
}

/* ---------- build ---------- */

function h2v_build(manifestPath, target) {
    try {
        if (!app.project) return 'ERROR|Please open or create a Premiere Pro project first.';
        var m = h2v_readManifest(manifestPath);
        var fps = m.fps;
        var useActive = target === 'active' && app.project.activeSequence;

        var bin = app.project.rootItem.createBin(m.title + ' (HTML to Video)');
        var layersBin = bin.createBin('Object layers');

        var bgItem = h2v_import(m.background.first, bin, m.title + ' - background', fps, true);
        var items = [];
        for (var i = 0; i < m.layers.length; i++) {
            items.push(h2v_import(m.layers[i].first, layersBin, m.layers[i].name, fps, true));
        }
        var sounds = [];
        for (var s = 0; s < m.audio.length; s++) {
            sounds.push(h2v_import(m.audio[s].file, bin, new File(m.audio[s].file).name, 0, false));
        }

        var seq;
        var firstTrack;
        var startTicks = 0;
        if (useActive) {
            seq = app.project.activeSequence;
            startTicks = parseFloat(seq.getPlayerPosition().ticks);
            firstTrack = seq.videoTracks.numTracks;
            h2v_addTracks(seq, m.layers.length + 1, sounds.length);
            seq = app.project.activeSequence;
            seq.videoTracks[firstTrack].overwriteClip(bgItem, h2v_ticks(startTicks));
        } else {
            var seqName = m.title + ' (HTML)';
            seq = null;
            if (app.project.createNewSequenceFromClips) {
                seq = app.project.createNewSequenceFromClips(seqName, [bgItem], bin);
            }
            if (!seq) {
                seq = app.project.createNewSequence(seqName, 'h2v-' + new Date().getTime());
                seq.videoTracks[0].overwriteClip(bgItem, h2v_ticks(0));
            }
            app.project.activeSequence = seq;
            firstTrack = 0;
            var needV = m.layers.length + 1 - seq.videoTracks.numTracks;
            var needA = sounds.length - seq.audioTracks.numTracks;
            h2v_addTracks(seq, Math.max(0, needV), Math.max(0, needA));
            seq = app.project.activeSequence;
        }
        var bgClip = h2v_lastClip(seq.videoTracks[firstTrack], bgItem);
        if (bgClip) bgClip.name = 'Background';

        // Positions are fractions of the HTML stage; map them to this
        // sequence's frame (the stage is centred if the sizes differ).
        var SW = m.width;
        var SH = m.height;
        try {
            if (seq.frameSizeHorizontal) { SW = seq.frameSizeHorizontal; SH = seq.frameSizeVertical; }
        } catch (e0) {}
        var place = function (x, y) {
            return [(x * m.width + (SW - m.width) / 2) / SW, (y * m.height + (SH - m.height) / 2) / SH];
        };

        var placed = 0;
        var keyed = 0;
        var tracks = seq.videoTracks.numTracks;
        for (var j = 0; j < items.length; j++) {
            var trackIndex = firstTrack + j + 1;
            if (trackIndex >= tracks) break;
            var L = m.layers[j];
            var track = seq.videoTracks[trackIndex];
            track.overwriteClip(items[j], h2v_ticks(startTicks + h2v_frameTicks(L.startFrame, fps)));
            var clip = h2v_lastClip(track, items[j]);
            if (clip) {
                try { clip.name = L.name; } catch (e1) {}
                if (L.kind === 'motion') {
                    try {
                        h2v_applyMotion(clip, L, m, place);
                        keyed++;
                    } catch (e2) {}
                }
            }
            placed++;
        }

        var aFirst = useActive ? seq.audioTracks.numTracks - sounds.length : 0;
        var soundsPlaced = 0;
        for (var a = 0; a < sounds.length; a++) {
            var at = seq.audioTracks[Math.max(0, Math.min(aFirst + a, seq.audioTracks.numTracks - 1))];
            if (!at) break;
            at.overwriteClip(sounds[a], h2v_ticks(startTicks + m.audio[a].start * H2V_TPS));
            soundsPlaced++;
        }

        try { app.project.openSequence(seq.sequenceID); } catch (e3) {}

        var msg = (useActive ? 'Added to "' + seq.name + '"' : 'Sequence "' + seq.name + '" created') +
            ': background + ' + placed + ' object track(s), ' + keyed + ' with editable keyframes' +
            (soundsPlaced ? ', ' + soundsPlaced + ' sound(s)' : '') + '. ' +
            m.frames + ' frames @ ' + fps + ' fps.';
        if (placed < items.length) {
            msg += ' ' + (items.length - placed) + ' layer(s) could not get a track; they are in the "Object layers" bin.';
        }
        return 'OK|' + msg;
    } catch (err) {
        return 'ERROR|' + err.toString() + (err.line ? ' (line ' + err.line + ')' : '');
    }
}
