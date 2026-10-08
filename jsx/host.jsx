/*
 * HTML to Video - Premiere Pro (ExtendScript) side.
 *
 * h2v_build(manifestPath) imports the rendered PNG sequences and builds a
 * sequence:  V1 = background, V2..Vn = one object (text, image, icon...)
 * per track, each clip starting at the frame where the object first appears.
 * Everything stays fully editable: move, trim, re-time or delete any object.
 */

var H2V_TICKS_PER_SECOND = 254016000000;

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

function h2v_time(frame, fps) {
    var t = new Time();
    t.ticks = String(Math.round(frame * H2V_TICKS_PER_SECOND / fps));
    return t;
}

function h2v_nodeIds(bin) {
    var ids = {};
    for (var i = 0; i < bin.children.numItems; i++) ids[bin.children[i].nodeId] = true;
    return ids;
}

function h2v_importSequence(firstFile, bin, name, fps) {
    var before = h2v_nodeIds(bin);
    app.project.importFiles([firstFile], true, bin, true); // true = numbered stills
    var item = null;
    for (var i = 0; i < bin.children.numItems; i++) {
        if (!before[bin.children[i].nodeId]) { item = bin.children[i]; break; }
    }
    if (!item) throw new Error('Could not import ' + firstFile);
    try { item.name = name; } catch (e1) {}
    try { item.setOverrideFrameRate(fps); } catch (e2) {}
    return item;
}

function h2v_ensureVideoTracks(seq, needed) {
    var have = seq.videoTracks.numTracks;
    if (have >= needed) return seq;
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    try {
        qeSeq.addTracks(needed - have, have, 0);
    } catch (e) {
        qeSeq.addTracks(needed - have, have, 0, 1, 0, 0, 0);
    }
    return app.project.activeSequence;
}

function h2v_nameClip(track, item, name) {
    for (var i = track.clips.numItems - 1; i >= 0; i--) {
        var c = track.clips[i];
        if (c.projectItem && c.projectItem.nodeId === item.nodeId) {
            try { c.name = name; } catch (e) {}
            return;
        }
    }
}

function h2v_build(manifestPath) {
    try {
        if (!app.project) return 'ERROR|Please open or create a Premiere Pro project first.';
        var m = h2v_readManifest(manifestPath);
        var fps = m.fps;

        var bin = app.project.rootItem.createBin(m.title + ' (HTML to Video)');
        var layersBin = bin.createBin('Object layers');

        var bgItem = h2v_importSequence(m.background.first, bin, m.title + ' - background', fps);
        var items = [];
        for (var i = 0; i < m.layers.length; i++) {
            items.push(h2v_importSequence(m.layers[i].first, layersBin, m.layers[i].name, fps));
        }

        var seqName = m.title + ' (HTML)';
        var seq = null;
        if (app.project.createNewSequenceFromClips) {
            seq = app.project.createNewSequenceFromClips(seqName, [bgItem], bin);
        }
        if (!seq) {
            seq = app.project.createNewSequence(seqName, 'h2v-' + new Date().getTime());
            seq.videoTracks[0].overwriteClip(bgItem, h2v_time(0, fps));
        }
        app.project.activeSequence = seq;
        h2v_nameClip(seq.videoTracks[0], bgItem, 'Background');

        seq = h2v_ensureVideoTracks(seq, m.layers.length + 1);
        var placed = 0;
        var tracks = seq.videoTracks.numTracks;
        for (var j = 0; j < items.length; j++) {
            var trackIndex = j + 1;
            if (trackIndex >= tracks) break;
            var track = seq.videoTracks[trackIndex];
            track.overwriteClip(items[j], h2v_time(m.layers[j].startFrame, fps));
            h2v_nameClip(track, items[j], m.layers[j].name);
            placed++;
        }

        try { app.project.openSequence(seq.sequenceID); } catch (e3) {}

        var msg = 'Sequence "' + seqName + '" created: background on V1 and ' + placed +
            ' object track(s) (V2-V' + (placed + 1) + '), ' + m.frames + ' frames @ ' + fps + ' fps.';
        if (placed < items.length) {
            msg += ' ' + (items.length - placed) + ' layer(s) could not get a track; they are in the "Object layers" bin.';
        }
        return 'OK|' + msg;
    } catch (err) {
        return 'ERROR|' + err.toString() + (err.line ? ' (line ' + err.line + ')' : '');
    }
}
