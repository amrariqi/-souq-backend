/**
 * سيرفر خلفي (Backend) لربط تطبيق السوق ببوابة NOWPayments
 * ------------------------------------------------------------
 * هذا الملف يعمل على سيرفر حقيقي (Node.js) — وليس داخل المتصفح —
 * لأن مفاتيح API السرية يجب ألا تظهر أبداً في كود يعمل على جهاز العميل.
 *
 * قبل التشغيل:
 *   1) npm init -y
 *   2) npm install express cors dotenv @nowpaymentsio/nowpayments-sdk-nodejs
 *   3) أنشئ ملف .env بجانب هذا الملف وضع فيه القيم الحقيقية (راجع .env.example)
 *   4) شغّل السيرفر محلياً للتجربة: node server.js
 *   5) لرفعه أونلاين بشكل دائم: استضفه على Render أو Railway (مجاني للبداية)
 */

require('dotenv/config');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
// نحتاج الجسم الخام (raw body) للتحقق من توقيع IPN بدقة
app.use('/webhooks/nowpayments', express.raw({ type: 'application/json' }));

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

let sdk; // سيتم تهيئته داخل async بسبب أن المكتبة ES Module فقط

async function initSdk() {
  const { NowPaymentsSDK } = await import('@nowpaymentsio/nowpayments-sdk-nodejs');
  sdk = new NowPaymentsSDK({
    apiKey: process.env.NOWPAYMENTS_API_KEY,           // من لوحة تحكم NOWPayments
  ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,      // من نفس الصفحة (IPN Secret Key)
  ipnCallbackUrl: `${PUBLIC_URL}/webhooks/nowpayments`,
  successUrl: `${PUBLIC_URL}/payment/success`,
    cancelUrl: `${PUBLIC_URL}/payment/cancel`,
  });
}

// ---------------------------------------------------------------
// قاعدة بيانات بسيطة في الذاكرة (للتجربة فقط)
// في الإنتاج الحقيقي استبدلها بقاعدة بيانات فعلية (MongoDB/PostgreSQL)
// ---------------------------------------------------------------
const orders = new Map(); // orderId -> { status, amount, ... }

/**
 * 1) العميل يضغط "ادفع بـ USDT" في الموقع
 *    الواجهة الأمامية (HTML) تستدعي هذا المسار
 */
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, orderId, description } = req.body;
    if (!amount || !orderId) {
      return res.status(400).json({ error: 'amount و orderId مطلوبان' });
    }

    const checkout = await sdk.createCheckout({
      amount: Number(amount),
      currency: 'usd',
      payCurrency: 'usdttrc20', // USDT عبر شبكة TRON (رسوم أقل)
      orderId,
      description: description || `طلب رقم ${orderId}`,
    });

    orders.set(orderId, { status: 'waiting', amount, invoiceId: checkout.id });

    res.json({
      invoiceId: checkout.id,
      invoiceUrl: checkout.invoice_url, // وجّه العميل لهذا الرابط لإتمام الدفع
    });
  } catch (err) {
    console.error('خطأ في إنشاء الفاتورة:', err.message);
    res.status(500).json({ error: 'تعذر إنشاء طلب الدفع' });
  }
});

/**
 * 2) NOWPayments يرسل تأكيد الدفع تلقائياً هنا (IPN) بعد أن يدفع العميل فعلياً
 *    هذا هو "التأكيد التلقائي" الذي طلبته سابقاً
 */
app.post('/webhooks/nowpayments', (req, res) => {
  try {
    const signature = req.headers['x-nowpayments-sig'];
    const isValid = sdk.verifyIpnSignature({
      rawBody: req.body, // Buffer خام
      signature,
    });

    if (!isValid) {
      console.warn('⚠️ توقيع IPN غير صالح — تم تجاهل الطلب');
      return res.status(401).send('Invalid signature');
    }

    const payload = JSON.parse(req.body.toString('utf8'));
    const { order_id, payment_status } = payload;

    const order = orders.get(order_id);
    if (order) {
      order.status = payment_status; // waiting / confirming / confirmed / finished / failed
      orders.set(order_id, order);
      console.log(`✅ تحديث حالة الطلب ${order_id}: ${payment_status}`);

      // TODO: هنا تربط قاعدة بياناتك الحقيقية:
      // - حدّث حالة الطلب في تطبيق السوق (souq-marketplace.html)
      // - أرسل إشعار/بريد للبائع والعميل عند payment_status === 'finished'
    }

    res.status(200).send('OK'); // NOWPayments يتطلب رد 200 لتأكيد الاستلام
  } catch (err) {
    console.error('خطأ في معالجة IPN:', err.message);
    res.status(500).send('Error');
  }
});

/**
 * 3) الواجهة الأمامية تسأل: هل تم الدفع أم لا؟ (Polling بسيط)
 */
app.get('/api/order-status/:orderId', (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json(order);
});

app.get('/payment/success', (req, res) => res.send('✅ تم الدفع بنجاح، شكراً لك!'));
app.get('/payment/cancel', (req, res) => res.send('❌ تم إلغاء الدفع.'));

app.listen(PORT, async () => {
  await initSdk(); // تهيئة SDK بعد بدء الاستماع (المكتبة ES Module فقط)
  console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
  console.log(`🔗 رابط الـ Webhook الذي يجب وضعه في NOWPayments: ${PUBLIC_URL}/webhooks/nowpayments`);
});
