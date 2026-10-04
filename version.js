/*
  version.js
  ----------
  Muestra la versión de la app en una esquina de la pantalla, para
  confirmar de un vistazo que la página publicada ya es la nueva
  (y no una copia vieja en caché).

  Se muestra así: "vX · a1b2c3d"
    - vX    -> APP_VERSION.
    - a1b2c3d -> hash corto del commit publicado. Lo escribe solo el
                 workflow de GitHub (.github/workflows/pages.yml) al
                 desplegar. Si abres la app en local o en Codespaces,
                 donde ese paso no corre, muestra "dev".
*/

const APP_VERSION = "v2.2";
const APP_COMMIT = "__COMMIT__";
const APP_COMMIT_VISIBLE = APP_COMMIT.indexOf("__") === 0 ? "dev" : APP_COMMIT;
const APP_VERSION_COMPLETA = APP_VERSION + " · " + APP_COMMIT_VISIBLE;

(function () {
  console.log("Control Hielitos " + APP_VERSION_COMPLETA);

  // Dentro de un iframe (modales de movimientos / editar stock) no se muestra
  if (window.self !== window.top) return;

  function mostrarVersion() {
    if (document.getElementById("versionApp")) return;
    const etiqueta = document.createElement("div");
    etiqueta.id = "versionApp";
    etiqueta.textContent = APP_VERSION_COMPLETA;
    etiqueta.style.cssText =
      "position:fixed;right:8px;bottom:calc(6px + env(safe-area-inset-bottom, 0px));" +
      "font:11px/1 system-ui,-apple-system,sans-serif;color:#555;" +
      "background:rgba(255,255,255,0.75);padding:3px 7px;border-radius:10px;" +
      "z-index:50;pointer-events:none;opacity:0.8;";
    document.body.appendChild(etiqueta);
  }

  if (document.body) mostrarVersion();
  else document.addEventListener("DOMContentLoaded", mostrarVersion);
})();
