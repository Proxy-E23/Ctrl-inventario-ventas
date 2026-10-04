/*
  data.js
  -------
  Único lugar del proyecto que sabe DÓNDE viven los datos.
  Ahora usa Firebase Realtime Database (antes usaba localStorage).
  Las páginas .html no se tocaron: siguen llamando a los mismos
  nombres (getSabores, registrarVenta, etc.) — solo cambió lo que
  hay ADENTRO de estas funciones.

  Requiere que firebase-config.js se cargue ANTES que este archivo
  en cada página (define la variable global "db").
*/

// ======================================================================
// FECHA Y HORA
// Antes cada página forzaba GMT-6 manualmente (asumiendo México),
// lo cual se desfasaba si el teléfono estaba en otra zona horaria o
// tenía la hora del sistema distinta. Ahora se usa directamente la
// hora que el propio dispositivo ya calcula correctamente.
// ======================================================================

function obtenerFechaLocal() {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = (ahora.getMonth() + 1).toString().padStart(2, "0");
  const dia = ahora.getDate().toString().padStart(2, "0");
  return `${año}-${mes}-${dia}`;
}

function obtenerHoraLocal() {
  const ahora = new Date();
  const horas = ahora.getHours().toString().padStart(2, "0");
  const minutos = ahora.getMinutes().toString().padStart(2, "0");
  return `${horas}:${minutos}`;
}

function obtenerFechaHoraLocal() {
  return {
    fecha: obtenerFechaLocal(),
    hora: obtenerHoraLocal(),
  };
}

const CLAVES = {
  SABORES: "shielitos",
  INVENTARIO: "inventario_hielitos",
  PRECIOS: "precios_hielitos",
  VENTAS: "ventas_hielitos",
  META: "meta_hielitos",
};

// ---------- Helpers internos (no usar fuera de este archivo) ----------

// Tres niveles, del más rápido al más lento:
//  1. _cache (memoria): solo dura mientras esta página está abierta.
//  2. localStorage (disco): sobrevive a cerrar la pestaña o cambiar
//     de página. Es lo que hace que "Fresa, Mango..." aparezcan de
//     inmediato al abrir inventario.html, en vez de una pantalla en
//     blanco esperando la red.
//  3. Firebase (red): la fuente de verdad real. Cada clave activa un
//     listener .on("value") que, en cuanto Firebase responde (aunque
//     sea unos milisegundos después), actualiza los niveles 1 y 2 en
//     silencio -- si algo cambió, la pantalla se refresca sola.
const _cache = {};
const _listenersActivos = {};

// Copia profunda: las funciones get*() devuelven una copia, no el objeto
// de la caché. Así, si una operación modifica los datos y luego falla (o
// se repite), la caché no queda alterada con cambios que nunca se guardaron.
function _clonar(valor) {
  return valor === null || valor === undefined
    ? valor
    : JSON.parse(JSON.stringify(valor));
}
const PREFIJO_CACHE_LOCAL = "cache_firebase_";

function _leerCacheLocal(clave) {
  try {
    const crudo = localStorage.getItem(PREFIJO_CACHE_LOCAL + clave);
    return crudo === null ? undefined : JSON.parse(crudo);
  } catch (error) {
    return undefined;
  }
}

function _guardarCacheLocal(clave, valor) {
  try {
    localStorage.setItem(PREFIJO_CACHE_LOCAL + clave, JSON.stringify(valor));
  } catch (error) {
    // localStorage lleno o bloqueado: no es crítico, Firebase sigue
    // funcionando igual, solo se pierde la ventaja de la copia local.
    console.warn(`data.js: no se pudo cachear "${clave}" en localStorage`, error);
  }
}

function _asegurarListener(clave) {
  if (_listenersActivos[clave]) return;

  db.ref(clave).on("value", (snapshot) => {
    const valor = snapshot.val();
    _cache[clave] = valor;
    _guardarCacheLocal(clave, valor);
  });

  _listenersActivos[clave] = true;
}

async function _leer(clave, porDefecto) {
  try {
    if (!(clave in _cache)) {
      // Primero, lo que ya haya en disco de una visita anterior --
      // esto es instantáneo, no espera a la red.
      const cacheado = _leerCacheLocal(clave);
      if (cacheado !== undefined) {
        _cache[clave] = cacheado;
      }

      // Firebase sigue arrancando en paralelo: cuando responda (ya sea
      // ahora si no había caché local, o después para confirmar/corregir
      // el dato cacheado), _asegurarListener actualiza todo solo.
      _asegurarListener(clave);

      if (cacheado === undefined) {
        // No había nada guardado localmente: sí hay que esperar la
        // primera respuesta real de Firebase antes de devolver algo.
        const snapshot = await db.ref(clave).once("value");
        _cache[clave] = snapshot.val();
        _guardarCacheLocal(clave, _cache[clave]);
      }
    }
    const valor = _cache[clave];
    return valor === null || valor === undefined ? porDefecto : _clonar(valor);
  } catch (error) {
    console.error(`data.js: no se pudo leer "${clave}" de Firebase`, error);
    // Si Firebase falla (sin internet, por ejemplo) pero hay copia
    // local, mejor mostrar esa que nada.
    const cacheado = _leerCacheLocal(clave);
    return cacheado !== undefined ? cacheado : porDefecto;
  }
}

async function _guardar(clave, valor) {
  await db.ref(clave).set(valor);
  valor = _clonar(valor);
  // Actualizamos memoria y disco de inmediato (no esperamos al
  // listener): así, si algo lee esta misma clave justo después de
  // guardar en esta misma página, ve el dato recién escrito.
  _cache[clave] = valor;
  _guardarCacheLocal(clave, valor);
  _asegurarListener(clave);
}

async function _borrar(clave) {
  await db.ref(clave).remove();
  _cache[clave] = null;
  _asegurarListener(clave);
}

// ======================================================================
// PROTECCIÓN CONTRA ENVÍOS DUPLICADOS
// Si la red va lenta o el botón se pulsa dos (o más) veces seguidas, la
// misma operación podía ejecutarse varias veces y duplicar ventas,
// stock o registros. ejecutarUnaVez() lo evita con un único "candado"
// por página: mientras una operación de escritura sigue en curso, las
// demás (incluida la misma repetida) se ignoran. Además deshabilita los
// botones indicados y avisa si el servidor tarda en responder.
//
// fn: función (normalmente async) con toda la operación, incluyendo
//     validaciones, confirm() y el cierre del modal.
// opciones:
//   botones: selector CSS de los botones a deshabilitar mientras dura.
//   textoOcupado: texto temporal del botón (null = no cambiar el texto).
//   mantenerBloqueadoSiExito: si fn termina sin devolver false, el
//     candado NO se libera (para modales que se cierran al terminar).
// Si fn lanza error o devuelve false, el candado se libera para poder
// reintentar (en ese caso la operación no se completó).
// ======================================================================

let _escrituraEnCurso = false;
const SEGUNDOS_AVISO_LENTO = 6;

function _mostrarAvisoLento() {
  if (document.getElementById("avisoOperacionLenta")) return;
  const aviso = document.createElement("div");
  aviso.id = "avisoOperacionLenta";
  aviso.textContent =
    "⏳ El servidor tarda en responder. Tu operación se enviará sola en cuanto haya conexión. No la repitas.";
  aviso.style.cssText =
    "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);" +
    "max-width:90%;background:#333;color:#fff;padding:0.8rem 1.2rem;" +
    "border-radius:8px;font-size:0.9rem;z-index:99999;text-align:center;" +
    "box-shadow:0 2px 10px rgba(0,0,0,0.3);";
  document.body.appendChild(aviso);
}

function _ocultarAvisoLento() {
  const aviso = document.getElementById("avisoOperacionLenta");
  if (aviso) aviso.remove();
}

async function ejecutarUnaVez(fn, opciones = {}) {
  if (_escrituraEnCurso) {
    console.warn("data.js: operación ignorada, ya hay otra en curso");
    return undefined;
  }
  _escrituraEnCurso = true;

  const textoOcupado =
    opciones.textoOcupado === undefined ? "Guardando..." : opciones.textoOcupado;
  const botones = opciones.botones
    ? Array.from(document.querySelectorAll(opciones.botones))
    : [];
  const estadoPrevio = botones.map((b) => ({
    boton: b,
    texto: b.textContent,
    deshabilitado: b.disabled,
  }));
  botones.forEach((b) => {
    b.disabled = true;
    if (textoOcupado !== null) b.textContent = textoOcupado;
  });

  const temporizador = setTimeout(_mostrarAvisoLento, SEGUNDOS_AVISO_LENTO * 1000);
  let liberar = true;

  try {
    const resultado = await fn();
    if (opciones.mantenerBloqueadoSiExito && resultado !== false) {
      liberar = false;
    }
    return resultado;
  } finally {
    clearTimeout(temporizador);
    _ocultarAvisoLento();
    if (liberar) {
      estadoPrevio.forEach(({ boton, texto, deshabilitado }) => {
        boton.disabled = deshabilitado;
        if (textoOcupado !== null) boton.textContent = texto;
      });
      _escrituraEnCurso = false;
    }
  }
}

// ======================================================================
// SABORES
// Forma: [{ id, nombre, disponible, ... }, ...]
// ======================================================================

async function getSabores() {
  return _leer(CLAVES.SABORES, []);
}

async function getSaboresDisponibles() {
  const sabores = await getSabores();
  return sabores.filter((s) => s.disponible === true);
}

async function guardarSabores(sabores) {
  await _guardar(CLAVES.SABORES, sabores);
}

async function borrarSabores() {
  await _borrar(CLAVES.SABORES);
}

// ======================================================================
// INVENTARIO
// Forma: { [saborId]: { sabor, stock, historial: [ {fecha, hora,
//          cantidad, tipo, stockResultante} ] } }
// ======================================================================

async function getInventario() {
  return _leer(CLAVES.INVENTARIO, {});
}

async function guardarInventario(inventario) {
  await _guardar(CLAVES.INVENTARIO, inventario);
}

async function borrarInventario() {
  await _borrar(CLAVES.INVENTARIO);
}

/**
 * Suma stock a uno o varios sabores y deja registro en el historial.
 * items: [{ id, cantidad }]
 * Devuelve un resumen por sabor: [{ nombre, cantidad, stockAnterior, stockNuevo }]
 */
async function agregarStock(items, fecha, hora) {
  const inventario = await getInventario();
  const sabores = await getSabores();
  const resumen = [];

  for (const item of items) {
    const sabor = sabores.find((s) => s.id === item.id);
    if (!sabor) continue;

    if (!inventario[item.id]) {
      inventario[item.id] = { sabor: sabor.nombre, stock: 0, historial: [] };
    }

    const stockAnterior = inventario[item.id].stock;
    inventario[item.id].stock += item.cantidad;

    inventario[item.id].historial.push({
      fecha,
      hora,
      cantidad: item.cantidad,
      tipo: "entrada",
      stockResultante: inventario[item.id].stock,
    });

    resumen.push({
      nombre: sabor.nombre,
      cantidad: item.cantidad,
      stockAnterior,
      stockNuevo: inventario[item.id].stock,
    });
  }

  await guardarInventario(inventario);
  return resumen;
}

/**
 * Resta stock (usado al vender) y deja registro "venta" en el historial.
 * No guarda el inventario por sí sola: quien vende también necesita
 * guardar la venta en el mismo momento, así que ver registrarVenta().
 */
function _descontarStockEnMemoria(inventario, saborId, cantidad, fecha, hora) {
  if (!inventario[saborId]) return;
  inventario[saborId].stock -= cantidad;
  inventario[saborId].historial.push({
    fecha,
    hora,
    cantidad: -cantidad,
    tipo: "venta",
    stockResultante: inventario[saborId].stock,
  });
}

// ======================================================================
// PRECIOS
// Forma: [{ id, precio, fecha, actual }, ...]
// ======================================================================

async function getPrecios() {
  return _leer(CLAVES.PRECIOS, []);
}

async function getPrecioActual() {
  const precios = await getPrecios();
  const activo = precios.find((p) => p.actual);
  return activo ? activo.precio : null;
}

async function guardarPrecios(precios) {
  await _guardar(CLAVES.PRECIOS, precios);
}

async function borrarPrecios() {
  await _borrar(CLAVES.PRECIOS);
}

// ======================================================================
// VENTAS
// Forma: [{ id, fecha, hora, items: [{sabor, cantidad}], precioUnitario,
//           totalHielitos, montoTotal }, ...]
// ======================================================================

async function getVentas() {
  return _leer(CLAVES.VENTAS, []);
}

async function guardarVentas(ventas) {
  await _guardar(CLAVES.VENTAS, ventas);
}

async function borrarVentas() {
  await _borrar(CLAVES.VENTAS);
}

/**
 * Registra una venta completa: descuenta inventario, agrega al
 * historial de cada sabor, y guarda la venta. Hace las dos escrituras
 * (inventario + ventas) juntas, igual que hacía ventas.html antes.
 *
 * itemsVendidos: [{ id, sabor, cantidad }]
 */
async function registrarVenta(itemsVendidos, fecha, hora, precioUnitario) {
  if (!itemsVendidos || itemsVendidos.length === 0) {
    throw new Error("registrarVenta: no hay items que vender");
  }
  const inventario = await getInventario();
  const ventas = await getVentas();

  let montoTotal = 0;
  const itemsGuardados = [];

  for (const item of itemsVendidos) {
    _descontarStockEnMemoria(inventario, item.id, item.cantidad, fecha, hora);
    itemsGuardados.push({ sabor: item.sabor, cantidad: item.cantidad });
    montoTotal += item.cantidad * precioUnitario;
  }

  const ventaCompleta = {
    id: `venta_${Date.now()}`,
    fecha,
    hora,
    items: itemsGuardados,
    precioUnitario,
    totalHielitos: itemsGuardados.reduce((sum, i) => sum + i.cantidad, 0),
    montoTotal,
  };

  ventas.push(ventaCompleta);

  await guardarInventario(inventario);
  await _guardar(CLAVES.VENTAS, ventas);

  return ventaCompleta;
}

// ======================================================================
// ALERTAS
// No usan Firebase Cloud Functions (eso requeriría el plan de pago).
// En su lugar, cada vez que alguien abre la app o registra una venta,
// se revisan las condiciones aquí mismo y se muestra una notificación
// local del navegador si algo lo amerita. No es push "de verdad" (no
// llega si el teléfono lleva días sin abrirse), pero cubre el caso de
// uso real: la app se abre varias veces al día.
// ======================================================================

const UMBRAL_STOCK_BAJO = 5;
const DIAS_SIN_RESPALDO_AVISO = 3;

/**
 * Se llama una sola vez desde index.html/login.html al cargar, para
 * pedir permiso de notificaciones. Sin esto, Notification.requestPermission
 * nunca se dispara y las alertas no pueden mostrarse.
 */
async function pedirPermisoNotificaciones() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const resultado = await Notification.requestPermission();
  return resultado === "granted";
}

function _mostrarNotificacion(titulo, cuerpo) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  // Si hay un service worker activo, mostrarla a través de él es más
  // confiable en Android (persiste aunque la pestaña se minimice).
  if (navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then((registro) => {
      registro.showNotification(titulo, {
        body: cuerpo,
        icon: "icon-192.png",
        badge: "icon-192.png",
      });
    });
  } else {
    new Notification(titulo, { body: cuerpo, icon: "icon-192.png" });
  }
}

async function getUltimoRespaldo() {
  const meta = await _leer(CLAVES.META, {});
  return meta.ultimoRespaldo || null;
}

/**
 * Se llama desde index.html justo después de exportar el respaldo,
 * para que la app sepa que ya no hace falta recordárselo por unos días.
 */
async function registrarRespaldoHecho() {
  const meta = await _leer(CLAVES.META, {});
  meta.ultimoRespaldo = obtenerFechaLocal();
  await _guardar(CLAVES.META, meta);
}

function _diasEntre(fechaA, fechaB) {
  const msPorDia = 1000 * 60 * 60 * 24;
  const a = new Date(fechaA + "T00:00:00");
  const b = new Date(fechaB + "T00:00:00");
  return Math.round((b - a) / msPorDia);
}

/**
 * Revisa stock bajo y respaldo pendiente, y muestra notificaciones
 * locales si corresponde. Pensada para llamarse:
 *  - al cargar index.html (una vez por sesión)
 *  - justo después de registrarVenta() (para detectar stock recién bajo)
 *
 * No repite el mismo aviso dentro de la misma sesión del navegador
 * (usa sessionStorage), para no ser repetitiva si se abre varias
 * páginas seguidas.
 */
async function revisarAlertas() {
  const yaAvisadoStock = sessionStorage.getItem("alerta_stock_mostrada");
  const yaAvisadoRespaldo = sessionStorage.getItem("alerta_respaldo_mostrada");

  if (!yaAvisadoStock) {
    const inventario = await getInventario();
    const saboresDisponibles = await getSaboresDisponibles();
    const idsDisponibles = new Set(saboresDisponibles.map((s) => s.id));

    // Solo avisar de sabores que SÍ están a la venta (disponible=true).
    // Un sabor descontinuado con stock en 0 no necesita alerta, porque
    // no se está vendiendo activamente.
    const saboresBajos = Object.entries(inventario)
      .filter(([id, item]) => idsDisponibles.has(id) && item.stock <= UMBRAL_STOCK_BAJO)
      .map(([id, item]) => item);

    if (saboresBajos.length > 0) {
      const nombres = saboresBajos.map((s) => `${s.sabor} (${s.stock})`).join(", ");
      _mostrarNotificacion(
        "Quedan pocos hielitos",
        `Stock bajo: ${nombres}`
      );
      sessionStorage.setItem("alerta_stock_mostrada", "1");
    }
  }

  if (!yaAvisadoRespaldo) {
    const ultimoRespaldo = await getUltimoRespaldo();
    const hoy = obtenerFechaLocal();

    const diasSinRespaldo = ultimoRespaldo
      ? _diasEntre(ultimoRespaldo, hoy)
      : DIAS_SIN_RESPALDO_AVISO + 1; // Si nunca se ha hecho, avisar directo

    if (diasSinRespaldo >= DIAS_SIN_RESPALDO_AVISO) {
      _mostrarNotificacion(
        "Falta hacer respaldo",
        `Han pasado ${diasSinRespaldo} días desde el último respaldo`
      );
      sessionStorage.setItem("alerta_respaldo_mostrada", "1");
    }
  }
}
