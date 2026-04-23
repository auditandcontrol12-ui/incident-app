document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value.trim().toLowerCase();
  const msg = document.getElementById("msg");

  if (!email) {
    msg.textContent = "Please enter email.";
    return;
  }

  try {
    msg.textContent = "Sending OTP...";

    const res = await fetch("/api/requestOtp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    const text = await res.text();

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      msg.textContent = `API returned non-JSON (${res.status}): ${text}`;
      return;
    }

    if (!res.ok) {
      msg.textContent = data.message || `Failed to send OTP. Status ${res.status}`;
      return;
    }

    sessionStorage.setItem("login_email", email);
    window.location.href = "/otp.html";
  } catch (error) {
    msg.textContent = `Request failed: ${error.message}`;
  }
});