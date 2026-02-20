8522177044:AAGDNs-xTtojTkHbFGMRo-ZgSA89aqci1_I
sheenleen2_db_user
0In8TNCIOkzkMLNh

mongodb+srv://<db_username>:<db_password>@cluster0.hidqzgz.mongodb.net/


2. What you must give her:
To make the Telegram notifications work automatically, she must add your Webhook URL to her Paystack settings.

Tell her:

"Please go to Settings > 
API Keys & Webhooks in your Paystack dashboard and add this URL to the Webhook URL field:
 https://your-backend-api-url.com/api/orders/webhook"

TELEGRAM_BOT_TOKEN=8586568029:AAF4pOR-QcYqU2O1I3H35z9O1c_QDWD8lOA

TELEGRAM_ADMIN_CHAT_ID=1178067072

PAYSTACK_SECRET_KEY=your_paystack_secret_key_here

WEBHOOK SETUP:
1. Copy your backend URL + "/api/orders/webhook"
2. Go to Paystack Dashboard > Settings > API Keys & Webhooks
3. Paste the URL in Webhook URL field
4. Save the webhook

WEBHOOK EVENTS HANDLED:
- charge.success: Payment successful
- charge.failed: Payment failed
- transfer.success: Payout successful
- transfer.failed: Payout failed

NOTIFICATIONS:
- Telegram notifications sent for payment status changes
- Order status updated automatically
- Customer receives payment confirmation