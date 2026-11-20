import { api, getToken, setToken } from '$lib/api.js';

// Sesión compartida entre Sidebar, Topbar y páginas (Svelte 5 runes)
export const sesion = $state({ user: null, cargada: false });

export async function cargarSesion() {
  if (!getToken()) {
    sesion.user = null;
    sesion.cargada = true;
    return null;
  }
  try {
    const { user } = await api.me();
    sesion.user = user || null;
  } catch {
    sesion.user = null;
  }
  sesion.cargada = true;
  return sesion.user;
}

export function limpiarSesion() {
  setToken(null);
  sesion.user = null;
  sesion.cargada = true;
}
