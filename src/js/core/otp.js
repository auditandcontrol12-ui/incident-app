document.getElementById("otpForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = sessionStorage.getItem("login_email");
  const otp = document.getElementById("otp").value.trim();
  const msg = document.getElementById("msg");

  if (!email) {
    msg.textContent = "Session expired. Please login again.";
    return;
  }

  if (!otp) {
    msg.textContent = "Please enter OTP.";
    return;
  }

  msg.textContent = "Verifying OTP...";

  const res = await fetch("/api/verifyOtp", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, otp })
  });

  const data = await res.json();

  if (!res.ok) {
    msg.textContent = data.message || "OTP verification failed.";
    return;
  }

  sessionStorage.removeItem("login_email");
  window.location.href = "/dashboard.html";
});