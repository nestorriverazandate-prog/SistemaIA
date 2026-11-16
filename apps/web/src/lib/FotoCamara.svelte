<script>
 // Modal de captura con cualquier cámara disponible (webcam, USB, etc.)
 let { visible = $bindable(false), onCapture = () => {} } = $props();

 let video = $state(null);
 let stream = null;
 let error = $state('');

 async function iniciar() {
  error = '';
  try {
   stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
   if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
  } catch (e) {
   error = e?.name === 'NotAllowedError'
    ? 'Permiso de cámara denegado. Actívalo en el navegador (candado junto a la URL).'
    : 'No se encontró ninguna cámara disponible.';
  }
 }

 function detener() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
 }

 async function capturar() {
  if (!video || !video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  detener();
  visible = false;
  onCapture(dataUrl);
 }

 function cerrar() { detener(); error = ''; visible = false; }

 $effect(() => {
  if (visible) iniciar();
  else detener();
  return () => detener();
 });
</script>

{#if visible}
 <div class="cam-overlay" role="presentation" onclick={cerrar}>
  <div class="cam-sheet" onclick={(e) => e.stopPropagation()}>
   <h3>Tomar fotografía</h3>
   {#if error}
    <p class="error">{error}</p>
   {:else}
    <video bind:this={video} autoplay playsinline muted></video>
   {/if}
   <div class="btns">
    {#if !error}
     <button onclick={capturar}>Capturar</button>
    {/if}
    <button class="ghost" onclick={cerrar}>Cancelar</button>
   </div>
   <p class="muted small">Se usa la cámara seleccionada por el sistema (webcam o cámara conectada).</p>
  </div>
 </div>
{/if}

<style>
.cam-overlay { position: fixed; inset: 0; background: oklch(0.2 0.03 260 / .55); display: flex; align-items: center; justify-content: center; z-index: 80; padding: 1rem; }
.cam-sheet { background: #fff; border-radius: 16px; padding: 1.25rem; max-width: 480px; width: 100%; text-align: center; }
.cam-sheet h3 { margin-top: 0; }
video { width: 100%; max-height: 55vh; border-radius: 10px; background: #000; }
.btns { display: flex; gap: .5rem; justify-content: center; margin-top: .8rem; }
.btns .ghost { border: 1px solid oklch(0.45 0.03 225); background: transparent; color: oklch(0.45 0.03 225); }
.error { color: oklch(0.55 0.2 27); font-size: .85rem; }
.muted { color: oklch(0.45 0.03 225); }
.small { font-size: .78rem; }
</style>
