async function requireAuth() {
  const res = await fetch("/api/getMe", {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  });

  if (!res.ok) {
    window.location.href = "/login.html";
    return null;
  }

  const data = await res.json();

  if (!data.authenticated || !data.user) {
    window.location.href = "/login.html";
    return null;
  }

  return data.user;
}