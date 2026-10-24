export function registerPwa(): void {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).catch((error: unknown) => {
    console.warn('Offline support could not be enabled.', error);
  });
}
