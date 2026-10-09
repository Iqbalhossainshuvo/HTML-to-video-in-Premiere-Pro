# HTML to Video (বাংলা নির্দেশিকা)

যেকোনো HTML animation কে ব্রাউজারে যেভাবে চলে ঠিক সেভাবে ফ্রেম-বাই-ফ্রেম ভিডিও বানায়। ইন্টারনেট লাগে না।

## ১. শুধু ভিডিও চাইলে: HTMLtoVideo.exe

1. Repository-র **Releases** থেকে `HTMLtoVideo.exe` ডাউনলোড করুন (অথবা **Actions → Build Windows app → Artifacts**)।
2. ডাবল-ক্লিক করুন, অ্যাপ নিজের উইন্ডোতে খুলবে। (Windows সতর্কবার্তা দিলে *More info → Run anyway*)
3. **Open HTML file** দিয়ে আপনার HTML ফাইল খুলুন।
4. Resolution (Auto = পেজের নিজের সাইজ), Frame rate, Length, Quality বেছে **Render video** চাপুন।
5. ভিডিও প্লেয়ারে চলবে, ব্রাউজারে যেমন দেখায় ঠিক তেমন। **Live HTML** ট্যাবে আসল পেজ দেখা যায়।
6. প্লেয়ারের নিচে **Save to:** লেখায় দেখায় ভিডিও কোন ফোল্ডারে সেভ হবে (শুরুতে `Videos\HTML to Video`)। প্লেয়ারের উপরের **⬇** বাটন বা **Save video** চাপলেই মুহূর্তে সেখানে সেভ হয়। অন্য ফোল্ডার চাইলে **Change…** চাপুন, অ্যাপ সেটা মনে রাখবে।
7. এডিট করতে চাইলে উপরে ডানদিকের **Edit in Premiere / After Effects** চাপুন, তারপর **Premiere Pro** বা **After Effects** বেছে নিন। প্রথমবার প্লাগিন নিজে থেকেই ইনস্টল হয়ে যায়। অ্যাপ HTML-কে আলাদা আলাদা লেয়ারে ভাগ করে (প্রতিটি অবজেক্টের নিজস্ব keyframe সহ), তারপর প্রোগ্রামটা খোলে (খোলা থাকলে সেটাতে চলে যায়) আর সেখানে নতুন sequence / composition নিজে থেকেই বানিয়ে দেয়। প্লাগিন ইনস্টলের সময় প্রোগ্রাম খোলা থাকলে একবার বন্ধ করে আবার খুলুন, ভিডিও নিজে থেকেই খুলে যাবে।

রেজুলেশনের প্রতিটির উল্টো (vertical) ভার্সনও আছে: 1920×1080 ↔ 1080×1920, 1280×720 ↔ 720×1280, 2560×1440 ↔ 1440×2560, 3840×2160 ↔ 2160×3840, 1350×1080 ↔ 1080×1350, এছাড়া square 1080×1080 ও 2160×2160।
ভিডিওর দৈর্ঘ্য পেজ থেকে নিজে মেপে নেয় (টাইমার, `setInterval`, `requestAnimationFrame` লুপ, CSS, GSAP); কত সেকেন্ড পাওয়া গেল তা লগে দেখায়। নিজে ঠিক করতে চাইলে **Length** ঘরে সেকেন্ড লিখুন।

দরকার শুধু Google Chrome বা Microsoft Edge (Windows 10/11-এ Edge আগে থেকেই থাকে)।

## মোবাইল অ্যাপ (Android / iOS)

1. Releases থেকে `HTMLtoVideo-Android.apk` ডাউনলোড করে ফোনে ইনস্টল করুন।
2. HTML ফাইল (অথবা HTML + ছবি/ফন্ট/সাউন্ড সহ `.zip`) বেছে নিন, Size / Frame rate বেছে **Render video** চাপুন।
3. ভিডিও প্লেয়ারে চলবে, ব্রাউজারে যেমন দেখায় ঠিক তেমন। প্লেয়ারের নিচে **Save to:** লেখায় দেখাবে ভিডিও কোন ফোল্ডারে সেভ হবে (প্রথমবার একবার ফোল্ডার বেছে নিন, যেমন Movies বা Download; বদলাতে ওই লেখায় চাপুন)। **⬇** চাপলেই মুহূর্তে সেখানে সেভ হবে, পুরো ডেটা ঠিকমতো গেছে কিনা মিলিয়ে দেখা হয়। **⇪** দিয়ে শেয়ার করা যায়। কোনো ছবি/স্টোরেজ permission লাগে না।
4. HTML যত লম্বাই হোক পুরোটা রেন্ডার হয় (`const DURATION = …` থাকলে সেটা, না থাকলে GSAP সহ নিজে মেপে নেয়, ৫ মিনিট পর্যন্ত; আরও লম্বা হলে Length ঘরে সেকেন্ড লিখে দিন)।

বিস্তারিত: [mobile/README.md](mobile/README.md)

## ২. এডিট করতে চাইলে: Premiere Pro / After Effects প্লাগিন

1. `scripts\install-win.bat` (Windows) বা `bash scripts/install-mac.sh` (Mac) চালান।
2. Premiere Pro বা After Effects রিস্টার্ট করে **Window → Extensions → HTML to Video** খুলুন।
3. **Upload your file** → **New sequence / New composition** বা **Active** বেছে → **Convert video**।
4. প্রতিটি লেখা, ছবি, আইকন আলাদা ট্র্যাক/লেয়ারে আসবে। যেগুলো শুধু নড়ে, বড়-ছোট হয়, ঘোরে বা fade হয়, সেগুলোর **Position / Scale / Rotation / Opacity keyframe** এডিট করা যাবে। কোনো আইকন মুছতে ক্লিপ/লেয়ার সিলেক্ট করে Delete চাপুন।

## ৩. Claude দিয়ে HTML বানাতে

`skill/html-to-video.zip` Claude-এ skill হিসেবে আপলোড করুন, তারপর লিখুন যেমন *"Premiere-এর জন্য ১০ সেকেন্ডের logo reveal বানাও"*।

বিস্তারিত (ইংরেজিতে): [README.md](README.md)
