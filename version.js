/*
  version.js
  ----------
  Muestra la versión de la app en una esquina de la pantalla, para
  confirmar de un vistazo que la página publicada ya es la nueva
  (y no una copia vieja en caché).

  Se muestra así: "vX · a1b2c3d"
    - vX   -> APP_VERSION.
    - a1b2c3d -> hash corto del commit publicado. Lo escribe solo el
                 workflow de GitHub (.github/workflows/pages.yml) al
                 desplegar. Si abres la app en local o en Codespaces,
                 donde ese paso no corre, muestra "dev".
*/

const APP_VERSION = "v2.3.2";
const APP_COMMIT = "__COMMIT__";
const APP_COMMIT_VISIBLE = APP_COMMIT.indexOf("__") === 0 ? "dev" : APP_COMMIT;
const ES_BETA = window.location.pathname.indexOf("/beta/") !== -1;
const APP_VERSION_COMPLETA =
  APP_VERSION + " · " + APP_COMMIT_VISIBLE + (ES_BETA ? " · BETA" : "");
 
(function () {
  console.log("Control Hielitos " + APP_VERSION_COMPLETA);
 
  // Dentro de un iframe (modales de movimientos / editar stock) no se muestra
  if (window.self !== window.top) return;
 
  function mostrarVersion() {
    if (document.getElementById("versionApp")) return;
 
    // La etiqueta va al FINAL de la página (no fija en la pantalla): se ve
    // al llegar abajo del contenido. El body es una columna flex, así que
    // con margin-top:auto se pega al fondo aunque el contenido sea corto.
    document.body.style.minHeight = "100vh";
    document.body.style.minHeight = "100dvh"; // se ignora si no hay soporte
 
    const contenedor = document.createElement("div");
    contenedor.id = "versionApp";
    contenedor.style.cssText =
      "margin-top:auto;box-sizing:border-box;width:100%;text-align:right;" +
      "padding:14px 10px calc(8px + env(safe-area-inset-bottom, 0px));" +
      "pointer-events:none;";
 
    const etiqueta = document.createElement("span");
    etiqueta.textContent = APP_VERSION_COMPLETA;
    etiqueta.style.cssText =
      "display:inline-block;font:11px/1 system-ui,-apple-system,sans-serif;" +
      (ES_BETA
        ? "color:#fff;background:rgba(230,126,34,0.9);font-weight:bold;"
        : "color:#555;background:rgba(0,0,0,0.06);") +
      "padding:3px 7px;border-radius:10px;opacity:0.85;";
 
    contenedor.appendChild(etiqueta);
    document.body.appendChild(contenedor);
  }
 
  if (document.body) mostrarVersion();
  else document.addEventListener("DOMContentLoaded", mostrarVersion);
})();
 