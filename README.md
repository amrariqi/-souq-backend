# هذا الملف يجعل GitHub يبني تطبيق أندرويد (APK) تلقائيًا في كل مرة تُحدَّث
# فيها الشيفرة على الفرع الرئيسي — لا تحتاج تثبيت Flutter ولا أي أداة على
# جهازك. الملف الناتج يظهر جاهزًا للتنزيل من تبويب "Releases" في المستودع.
#
# لا تحتاج لتعديل أي شيء هنا؛ فقط ارفع هذا الملف بمساره الكامل كما هو
# (.github/workflows/build-apk.yml) إلى مستودعك على GitHub.

name: Build Android APK

on:
  push:
    branches: [main, master]
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Locate and unpack project source
        # يدعم الحالتين: رفع shop_pos_app.zip كملف واحد (الأسهل من الموبايل)،
        # أو رفع محتويات lib/ وpubspec.yaml كملفات منفردة مباشرة إلى جذر المستودع.
        # يطبع أيضًا محتوى المستودع بوضوح في السجل حتى يسهل تشخيص أي خطأ لاحقًا،
        # ويتوقف برسالة واضحة بدل الفشل الغامض إن لم يجد الملفات المطلوبة.
        run: |
          set -x
          echo "--- محتوى جذر المستودع قبل أي معالجة ---"
          ls -la

          if [ -f shop_pos_app.zip ]; then
            unzip -o shop_pos_app.zip -d .
          fi

          if [ -d shop_pos_app/lib ] && [ -f shop_pos_app/pubspec.yaml ]; then
            echo "SRC_DIR=shop_pos_app" >> "$GITHUB_ENV"
          elif [ -d lib ] && [ -f pubspec.yaml ]; then
            echo "SRC_DIR=." >> "$GITHUB_ENV"
          else
            echo "تعذّر العثور على مجلد lib وملف pubspec.yaml في المستودع."
            echo "--- محتوى المستودع الحالي (حتى 3 مستويات) ---"
            find . -maxdepth 3 -not -path "./.git*"
            exit 1
          fi

      - name: Set up Flutter
        uses: subosito/flutter-action@v2
        with:
          channel: stable
          cache: true

      - name: Show Flutter/Dart versions
        # للتشخيص فقط — يوضّح في السجل أي إصدار Dart/Flutter فعليًا يُستخدم،
        # فبعض إصدارات الحزم تتعارض مع إصدار Dart الجديد بمرور الوقت.
        run: flutter --version

      - name: Scaffold a full Flutter project and overlay our source
        run: |
          set -x
          flutter create --org com.shoppos --project-name shop_pos_app build_app
          rm -rf build_app/lib
          cp -r "$SRC_DIR/lib" build_app/lib
          cp "$SRC_DIR/pubspec.yaml" build_app/pubspec.yaml

          # نطاق إصدار Dart المذكور في pubspec.yaml قد يصبح أضيق من إصدار Dart
          # الفعلي بمرور الوقت — نوسّعه هنا تلقائيًا لتفادي فشل pub get لهذا السبب،
          # مهما كان محتوى الملف المرفوع فعليًا.
          sed -i "s/^  sdk: .*/  sdk: '>=3.0.0 <5.0.0'/" build_app/pubspec.yaml
          # حزمة intl مرتبطة بإصدار محدد يفرضه flutter_localizations نفسه؛
          # تثبيت رقم إصدار لها هنا يسبب تعارضًا متكررًا — نتركها بلا قيد.
          sed -i "s/^  intl:.*/  intl: any/" build_app/pubspec.yaml

          echo "--- pubspec.yaml النهائي المستخدم في البناء ---"
          cat build_app/pubspec.yaml
          echo "--- محتوى build_app/lib ---"
          find build_app/lib -maxdepth 2

      - name: Install dependencies
        working-directory: build_app
        run: flutter pub get

      - name: Build release APK
        working-directory: build_app
        run: flutter build apk --release

      - name: Publish APK to the "latest-test" release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: latest-test
          name: "أحدث نسخة تجريبية"
          body: >
            تُبنى تلقائيًا من آخر تحديث في الكود. نزّل ملف app-release.apk
            على هاتف أندرويد وثبّته (فعّل "السماح بالتثبيت من مصادر غير
            معروفة" إذا طلب منك ذلك).
          files: build_app/build/app/outputs/flutter-apk/app-release.apk
          make_latest: true
