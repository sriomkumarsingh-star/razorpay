


import express from "express";
import bodyParser from "body-parser";
import { dirname, join } from "path";
import crypto from 'crypto';
import { fileURLToPath } from "url";
import fs from 'fs';
import env from "dotenv";
import pg from "pg";
import Razorpay from "razorpay";
import { validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils.js';

env.config();
const __dirname = dirname(fileURLToPath(import.meta.url));

// The connection is named 'db' here
const db = new pg.Client({
  connectionString:process.env.DATA_URL
});

const razorpay = new Razorpay({
    key_id: process.env.RAZOR_KEY,
    key_secret: process.env.RAZOR_SECERT, // Make sure this typo matches your .env file!
});

const app = express();

// MIDDLEWARE (Moved express.json() up here)
app.use(express.static(join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json()); 

const FILE_PATH = 'order.json';

// Fixed the typo: orders.json -> FILE_PATH
const readData = () => {
  if (fs.existsSync(FILE_PATH)){
    const data = fs.readFileSync(FILE_PATH);
    return JSON.parse(data);
  }
  return [];
};

const writeData = (data) => {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
};

if(!fs.existsSync(FILE_PATH)){
  writeData([]);
}

// ROUTES
app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

app.post("/add", async (req, res) => {
    const newPostText = req.body.message;
    console.log(newPostText);

    if (newPostText && newPostText.trim() !== "") {
        try {
            await db.query("INSERT INTO blog (blogtext) VALUES ($1)", [newPostText]);
        } catch (err) {
            console.error("Error inserting post:", err);
        }
    }
    res.redirect("/");
});

app.post('/create-order', async (req, res) => {
  try {
    const { amount, currency, receipt, notes } = req.body;
    const options = {
      amount: amount * 100,
      currency: currency,
      receipt: receipt,
      notes: notes,
    };
    
    const order = await razorpay.orders.create(options);
    const orders = readData();
    orders.push({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: 'created',
    });
    writeData(orders);
    res.json(order);
  } catch(error) {
    console.log(error);
    res.status(500).send('error in creating order');
  }
});

app.post('/verify-payment', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        
        const secret = process.env.RAZOR_SECERT; 

        // 1. Verify the payment signature
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(body.toString())
            .digest('hex');

        const isAuthentic = expectedSignature === razorpay_signature;

        if (isAuthentic) {
            // 2. Fetch payment details from Razorpay
            const paymentDetails = await razorpay.payments.fetch(razorpay_payment_id);
            
            const amountInRupees = paymentDetails.amount / 100; 
            const currency = paymentDetails.currency;
            const paymentMethod = paymentDetails.method;
            const status = paymentDetails.status;

            const insertQuery = `
                INSERT INTO transaction (order_id, payment_id, amount, currency, methods, status, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
                RETURNING *;
            `;
            const values = [
                razorpay_order_id, 
                razorpay_payment_id, 
                amountInRupees, 
                currency, 
                paymentMethod, 
                status
            ];

            // FIXED: Changed 'pool.query' to 'db.query'
            const dbResult = await db.query(insertQuery, values);
            
            console.log("✅ Payment saved to database:", dbResult.rows[0]);
            console.log()

            res.status(200).json({
                success: true,
                message: "Payment verified and saved successfully",
                data: dbResult.rows[0]
            });

        } else {
            console.log("❌ Signature verification failed");
            res.status(400).json({
                success: false,
                message: "Invalid signature, payment verification failed"
            });
        }
    } catch (error) {
        console.error("Error verifying and saving payment:", error);
        res.status(500).json({
            success: false,
            message: "Error verifying paymentaa",
            error: error.message
        });
    }
});

app.get('/payment-success', (req, res) => {
  res.sendFile(join(__dirname, 'success.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});