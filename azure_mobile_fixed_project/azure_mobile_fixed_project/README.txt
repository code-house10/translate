طريقة الرفع على Vercel:

1) ارفع مجلد azure_mobile_fixed_project كاملًا، وليس ملف index.html وحده.
2) يجب أن يكون داخل المشروع:
   - index.html
   - api/azure-translate.js
3) بعد النشر افتح رابط Vercel من الموبايل وجرب زر Azure.

ملاحظة:
- النسخة تستخدم /api/azure-translate على Vercel بدل الاتصال المباشر من الموبايل إلى Azure.
- لذلك ستكون أكثر ثباتًا على الهاتف.
- يمكنك لاحقًا نقل مفاتيح Azure إلى Environment Variables في Vercel:
  AZURE_TRANSLATOR_KEY
  AZURE_TRANSLATOR_REGION
  AZURE_TRANSLATOR_ENDPOINT
