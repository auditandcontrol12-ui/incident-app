function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getOtpExpiry() {
  const mins = parseInt(process.env.OTP_EXPIRY_MINUTES || "5", 10);
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + mins);
  return expiry;
}

module.exports = { generateOtp, getOtpExpiry };