const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendOtpEmail(to, otpCode, userName) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Your OTP for Application Login",
    html: `
      <div style="font-family:Arial,sans-serif;">
        <p>Hello ${userName || "User"},</p>
        <p>Your login OTP is:</p>
        <h2 style="letter-spacing:4px;">${otpCode}</h2>
        <p>This OTP expires in ${process.env.OTP_EXPIRY_MINUTES || "5"} minutes.</p>
      </div>
    `
  });
}

module.exports = { sendOtpEmail };