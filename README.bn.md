# HTML to Video (বাংলা নির্দেশিকা)

যেকোনো HTML animation কে ব্রাউজারে যেভাবে চলে ঠিক সেভাবে ফ্রেম-বাই-ফ্রেম ভিডিও বানায়। ইন্টারনেট লাগে না।

## ১. শুধু ভিডিও চাইলে: HTMLtoVideo.exe

1. Repository-র **Releases** থেকে `HTMLtoVideo.exe` ডাউনলোড করুন (অথবা **Actions → Build Windows app → Artifacts**)।
2. ডাবল-ক্লিক করুন, অ্যাপ নিজের উইন্ডোতে খুলবে। (Windows সতর্কবার্তা দিলে *More info → Run anyway*)
3. **Open HTML file** দিয়ে আপনার HTML ফাইল খুলুন।
4. Resolution (Auto = পেজের নিজের সাইজ), Frame rate, Length, Quality বেছে **Render video** চাপুন।
5. ভিডিও প্লেয়ারে চলবে, ব্রাউজারে যেমন দেখায় ঠিক তেমন। **Live HTML** ট্যাবে আসল পেজ দেখা যায়।
6. প্লেয়ারের উপরের **⬇ (ডাউনলোড) বাটনে** ক্লিক করুন, **ফোল্ডার বেছে নিন**, MP4 সেখানে সেভ হবে।

দরকার শুধু Google Chrome বা Microsoft Edge (Windows 10/11-এ Edge আগে থেকেই থাকে)।

## মোবাইল অ্যাপ (Android / iOS)

1. Releases থেকে `HTMLtoVideo-Android.apk` ডাউনলোড করে ফোনে ইনস্টল করুন।
2. HTML ফাইল (অথবা HTML + ছবি/ফন্ট/সাউন্ড সহ `.zip`) বেছে নিন, Size / Frame rate বেছে **Render video** চাপুন।
3. ভিডিও প্লেয়ারে চলবে, ব্রাউজারে যেমন দেখায় ঠিক তেমন। প্লেয়ারের উপরের **⬇** চাপলে একটা ফোল্ডার বেছে নিতে বলবে (যেমন Movies বা Download), ভিডিও সেখানে সেভ হবে। **⇪** দিয়ে শেয়ার করা যায়। কোনো ছবি/স্টোরেজ permission লাগে না।

বিস্তারিত: [mobile/README.md](mobile/README.md)

## ২. এডিট করতে চাইলে: Premiere Pro / After Effects প্লাগিন

1. `scripts\install-win.bat` (Windows) বা `bash scripts/install-mac.sh` (Mac) চালান।
2. Premiere Pro বা After Effects রিস্টার্ট করে **Window → Extensions → HTML to Video** খুলুন।
3. **Upload your file** → **New sequence / New composition** বা **Active** বেছে → **Convert video**।
4. প্রতিটি লেখা, ছবি, আইকন আলাদা ট্র্যাক/লেয়ারে আসবে। যেগুলো শুধু নড়ে, বড়-ছোট হয়, ঘোরে বা fade হয়, সেগুলোর **Position / Scale / Rotation / Opacity keyframe** এডিট করা যাবে। কোনো আইকন মুছতে ক্লিপ/লেয়ার সিলেক্ট করে Delete চাপুন।

## ৩. Claude দিয়ে HTML বানাতে

`skill/html-to-video.zip` Claude-এ skill হিসেবে আপলোড করুন, তারপর লিখুন যেমন *"Premiere-এর জন্য ১০ সেকেন্ডের logo reveal বানাও"*।

বিস্তারিত (ইংরেজিতে): [README.md](README.md)
