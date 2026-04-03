self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}

  const title = data.title || "تنبيه سعر";
  const options = {
    body: data.body || "وصل إشعار جديد",
    data: { url: data.url || "/notifications", payload: data.payload || {} },
    badge: "/favicon.ico",
    icon: "/favicon.ico",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/notifications";
  event.waitUntil(clients.openWindow(url));
});
