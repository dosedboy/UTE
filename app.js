// =========================================================================
// === 1. CONFIGURACIÓN INICIAL DE SUPABASE ===
// =========================================================================

const SUPABASE_URL = 'https://hzmljjxtzbhfrdhtebgn.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6bWxqanh0emJoZnJkaHRlYmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMjYwNjUsImV4cCI6MjA3OTcwMjA2NX0.iz20qmfAEoJCnRKZmOFDovET-W3JfY9Dr8t-MnSUf_k'; 

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null; 

let currentReportZoneFilter = 'TODOS'; 
let currentMurosZoneFilter = 'TODOS'; 

const CAPA_SVG_MAP = {
    'BASAL': 'capa-basal', '1': 'capa-1', '2': 'capa-2', '3': 'capa-3', 
    '4': 'capa-4', '5': 'capa-5', '6': 'capa-6', 
};

// El orden de las capas de abajo hacia arriba (útil para la lógica jerárquica)
const CAPAS_ORDENADAS = ['BASAL', '1', '2', '3', '4', '5', '6'];

// =========================================================================
// === 2. FUNCIÓN DE NORMALIZACIÓN DE ZONA Y CÁLCULO DE TIEMPO ===
// =========================================================================

/**
 * Normaliza el nombre de la zona eliminando guiones, espacios y otros 
 * caracteres no alfanuméricos, y usando mayúsculas.
 * Ej: 'Mlp-2' -> 'MLP2'
 */
function normalizarZona(zona) {
    if (typeof zona !== 'string') return '';
    // 1. Convertir a mayúsculas
    let texto = zona.toUpperCase();
    // 2. Eliminar todo lo que no sea una letra (A-Z) o un número (0-9)
    return texto.replace(/[^A-Z0-9]/g, ''); 
}

/**
 * Verifica si la fecha de carga es menor a 24 horas.
 */
function esRegistroNuevo(recordFecha) {
    const now = new Date();
    const ONE_DAY_MS = 86400000; 
    const diff = now.getTime() - recordFecha.getTime();
    
    return diff <= ONE_DAY_MS;
}

// =========================================================================
// === 3. AUTENTICACIÓN Y MANEJO DE VISTAS ===
// =========================================================================

function cambiarVista(vista) {
    const views = {
        login: document.getElementById('viewLogin'),
        carga: document.getElementById('viewCarga'),
        visualizacion: document.getElementById('viewVisualizacion'),
        visualizacionMuros: document.getElementById('viewVisualizacionMuros') 
    };
    const nav = document.getElementById('mainNav');

    // Ocultar todas las vistas
    Object.values(views).forEach(v => {
        v.classList.replace('flex', 'hidden');
        v.classList.replace('block', 'hidden');
    });
    
    if (vista === 'login') {
        views.login.classList.replace('hidden', 'flex');
        nav.classList.add('hidden'); // Asegurarse que se oculte la nav al ir al login
    } else {
        nav.classList.remove('hidden'); // Mostrar la nav solo si no es login
        views[vista].classList.replace('hidden', 'block');
    }
    
    if (vista === 'visualizacion') {
        renderizarDatosReporte(); 
    } else if (vista === 'visualizacionMuros') {
         renderizarMuros(); 
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
    // **PASO 1: Asegurar que el contenido está oculto al inicio.**
    document.getElementById('mainNav').classList.add('hidden');
    document.getElementById('viewCarga').classList.add('hidden');
    document.getElementById('viewVisualizacion').classList.add('hidden');
    document.getElementById('viewVisualizacionMuros').classList.add('hidden');
    
    const { data: { user } } = await supabaseClient.auth.getUser();
    currentUser = user; 
    
    if (!currentUser) {
        // Si NO hay usuario, solo mostrar el Login.
        document.getElementById('viewLogin').classList.replace('hidden', 'flex'); 
        
    } else {
        // Si SÍ hay usuario, inicializar la sesión y mostrar el contenido.
        const userMetadata = currentUser.user_metadata;
        const userName = userMetadata.nombre_completo || currentUser.email; 

        document.getElementById('userInfo').innerText = `| Sesión: ${userName}`;
        
        // Ocultar login
        document.getElementById('viewLogin').classList.replace('flex', 'hidden');
        
        // Mostrar Navegación y la vista inicial (carga)
        document.getElementById('mainNav').classList.remove('hidden');
        cambiarPestana('carga'); 
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    
    if (error) {
        console.error("Login Error:", error);
        showAlertModal(`Error al iniciar sesión: ${error.message}`);
    } else {
        currentUser = data.user;
        document.getElementById('loginForm').reset();
        initializeApp(); 
    }
}

async function handleLogout() {
    const { error } = await supabaseClient.auth.signOut();
    
    if (error) {
        console.error("Logout Error:", error);
        showAlertModal(`Error al cerrar sesión: ${error.message}`);
    } else {
        currentUser = null;
        cambiarVista('login'); 
    }
}

function cambiarPestana(tab) {
    const views = ['carga', 'visualizacion', 'visualizacionMuros']; 
    const buttons = {
        carga: document.getElementById('btnCarga'),
        visualizacion: document.getElementById('btnVer'),
        visualizacionMuros: document.getElementById('btnVerMuros') 
    };
    
    views.forEach(view => {
        const btn = buttons[view];
        if (btn) {
            if (view === tab) {
                cambiarVista(tab);
                btn.className = "px-4 py-2 rounded-md text-sm font-medium transition-all bg-mining-accent text-white shadow";
            } else {
                btn.className = "px-4 py-2 rounded-md text-sm font-medium text-slate-400 hover:text-white transition-all";
            }
        }
    });
}

// =========================================================================
// === 4. LÓGICA DE DATOS (SUPABASE CRUD) - NORMALIZACIÓN Y EDICIÓN ===
// =========================================================================

/**
 * Lee los datos de Supabase.
 * Devuelve: { reporteDetallado: { zona: { muros: {}, canchas: [], ultimaFecha: Date } }, perfilesMuros: { muro-id: { capasEstado: {} } } }
 */
async function obtenerDatos() {
    if (!currentUser) return { reporteDetallado: {}, perfilesMuros: {} }; 

    const selectQueryMuros = 'id, fecha, zona, muro_id, capa, estado, turno, nombre_usuario'; 
    const selectQueryCanchas = 'id, fecha, zona, pileta, numero, material, turno, nombre_usuario'; 
    
    // **IMPORTANTE**: La consulta debe ordenar por fecha descendente
    const { data: murosRaw, error: murosError } = await supabaseClient.from('muros_registros').select(selectQueryMuros).order('fecha', { ascending: false }); 
    const { data: canchasRaw, error: canchasError } = await supabaseClient.from('canchas_registros').select(selectQueryCanchas).order('fecha', { ascending: false });
    
    if (murosError || canchasError) {
        console.error("Error al obtener datos de Supabase:", murosError || canchasError);
        return { reporteDetallado: {}, perfilesMuros: {} }; 
    }
    
    let datosDB = {}; 
    let perfilesMuros = {}; 
    
    // Función auxiliar para actualizar la última fecha de la zona
    const actualizarUltimaFechaZona = (zona, fechaStr) => {
        const fecha = new Date(fechaStr);
        if (!datosDB[zona]) {
            datosDB[zona] = { muros: {}, canchas: [], ultimaFecha: fecha };
        } else if (!datosDB[zona].ultimaFecha || fecha > datosDB[zona].ultimaFecha) {
            datosDB[zona].ultimaFecha = fecha;
        }
    };


    // 1. Procesar Muros (Reporte Detallado y Perfiles)
    murosRaw.forEach(record => {
        const zona = record.zona; 
        const muroId = record.muro_id.toUpperCase();
        const capa = record.capa.toUpperCase();
        const recordFecha = new Date(record.fecha);
        const claveMuro = `${zona} - ${muroId}`; 
        
        actualizarUltimaFechaZona(zona, record.fecha); // Actualizar fecha de la zona

        // A. Reporte Detallado
        if (!datosDB[zona].muros[muroId]) datosDB[zona].muros[muroId] = [];

        datosDB[zona].muros[muroId].push({
            id: record.id, capa: capa, estado: record.estado, turno: record.turno, 
            nombreUsuario: record.nombre_usuario || 'DESCONOCIDO', fecha: recordFecha.toLocaleString(), fechaRaw: recordFecha 
        });
        
        // B. Perfiles Muros (Lógica para determinar el último estado por capa)
        if (!perfilesMuros[claveMuro]) {
            perfilesMuros[claveMuro] = {
                zona: zona, 
                ultimaFecha: recordFecha, 
                capasEstado: {} 
            };
        } else if (recordFecha > perfilesMuros[claveMuro].ultimaFecha) {
            perfilesMuros[claveMuro].ultimaFecha = recordFecha; 
        }
        
        // Como la consulta ya está ordenada por fecha descendente, el primer registro (más reciente) define el estado.
        if (!perfilesMuros[claveMuro].capasEstado[capa]) {
            perfilesMuros[claveMuro].capasEstado[capa] = {
                estado: record.estado,
                fecha: recordFecha,
                recordId: record.id // <-- Añadido para hacer capas SVG clickeables
            };
        }
    });

    // 2. Procesar Canchas (Reporte Detallado)
    canchasRaw.forEach(record => {
        const zona = record.zona; 
        
        actualizarUltimaFechaZona(zona, record.fecha); // Actualizar fecha de la zona

        if (!datosDB[zona]) datosDB[zona] = { muros: {}, canchas: [], ultimaFecha: new Date(record.fecha) };
        if (!datosDB[zona].canchas) datosDB[zona].canchas = [];

        datosDB[zona].canchas.push({
            id: record.id, pileta: record.pileta.toUpperCase(), numero: record.numero.toUpperCase(),
            material: record.material, turno: record.turno, 
            nombreUsuario: record.nombre_usuario || 'DESCONOCIDO',
            fecha: new Date(record.fecha).toLocaleString(), fechaRaw: new Date(record.fecha)
        });
    });
    
    return { reporteDetallado: datosDB, perfilesMuros: perfilesMuros }; 
}

/**
 * Obtiene y consolida las 10 entradas más recientes de muros y canchas
 * para generar un log de actividad global.
 */
async function obtenerLogActividadGlobal() {
    if (!currentUser) return [];

    const selectQueryMuros = 'fecha, zona, muro_id, capa, estado, nombre_usuario';
    const selectQueryCanchas = 'fecha, zona, pileta, numero, material, nombre_usuario';

    // Obtener los 10 registros de muros más recientes
    const { data: murosRaw, error: murosError } = await supabaseClient
        .from('muros_registros')
        .select(selectQueryMuros)
        .order('fecha', { ascending: false })
        .limit(10); 

    // Obtener los 10 registros de canchas más recientes
    const { data: canchasRaw, error: canchasError } = await supabaseClient
        .from('canchas_registros')
        .select(selectQueryCanchas)
        .order('fecha', { ascending: false })
        .limit(10); 

    if (murosError || canchasError) {
        console.error("Error al obtener log de actividad:", murosError || canchasError);
        return [];
    }
    
    // Mapear y normalizar los registros
    const logMuros = murosRaw.map(r => ({
        fecha: new Date(r.fecha),
        tipo: 'Muro',
        usuario: r.nombre_usuario || 'Desconocido',
        detalle: `Zona ${r.zona} / Muro ${r.muro_id} / Capa ${r.capa} (${r.estado.toUpperCase()})`
    }));

    const logCanchas = canchasRaw.map(r => ({
        fecha: new Date(r.fecha),
        tipo: 'Cancha',
        usuario: r.nombre_usuario || 'Desconocido',
        detalle: `Zona ${r.zona} / Pileta ${r.pileta} / Cancha ${r.numero} (${r.material})`
    }));
    
    // Consolidar, ordenar y limitar a los 10 más recientes
    const logConsolidado = [...logMuros, ...logCanchas]
        .sort((a, b) => b.fecha.getTime() - a.fecha.getTime()) // Ordenar Descendente
        .slice(0, 10); // Limitar a los 10 más recientes

    return logConsolidado;
}

async function guardarDatos(e) {
    e.preventDefault();
    if (!currentUser) return showAlertModal("Error: Debe iniciar sesión para guardar datos.");

    const tipo = document.getElementById('selectTipo').value;
    const recordIdToModify = document.getElementById('recordIdToModify').value;
    const turno = document.getElementById('selectTurno').value.trim().toUpperCase(); 

    const userMetadata = currentUser.user_metadata;
    const userName = userMetadata.nombre_completo || currentUser.email;
    
    let tabla = '';
    let objetoRegistro = {};
    let isUpdate = !!recordIdToModify;
    
    if (tipo === 'muro') {
        tabla = 'muros_registros';
        
        // *** APLICACIÓN DE NORMALIZACIÓN DE ZONA ***
        const zonaRaw = document.getElementById('muroZona').value.trim();
        const zona = normalizarZona(zonaRaw); // Normaliza: MLP-2 -> MLP2

        const muroId = document.getElementById('muroId').value.trim().toUpperCase();
        const capa = document.getElementById('muroCapa').value.trim().toUpperCase(); 
        const esParcial = document.getElementById('checkParcial').checked;
        const esCompleta = document.getElementById('checkCompleta').checked;

        if (!esParcial && !esCompleta) {
            return showAlertModal("Debe seleccionar el estado de la capa (Parcial o Completa) para guardar el registro.");
        }
        
        // VALIDACIÓN AÑADIDA: Chequea si la capa está dentro de las permitidas
        if (!CAPAS_ORDENADAS.includes(capa)) {
            const capasValidas = CAPAS_ORDENADAS.join(', ');
            return showAlertModal(`La capa ingresada "${capa}" no es válida. Las capas permitidas son: ${capasValidas}.`);
        }

        objetoRegistro = {
            zona: zona, // Guarda la zona normalizada
            muro_id: muroId,
            capa: capa,
            estado: esParcial ? 'parcial' : 'completa',
            turno: turno, 
            user_id: currentUser.id,
            nombre_usuario: userName 
        };

    } else { // tipo === 'cancha'
        tabla = 'canchas_registros';
        
        // *** APLICACIÓN DE NORMALIZACIÓN DE ZONA ***
        const zonaRaw = document.getElementById('canchaZona').value.trim();
        const zona = normalizarZona(zonaRaw); // Normaliza: PC-3 -> PC3

        const pileta = document.getElementById('canchaPileta').value.trim().toUpperCase();
        const cancha = document.getElementById('canchaNumero').value.trim().toUpperCase();
        const material = document.getElementById('canchaMaterial').value;
        
        objetoRegistro = {
            zona: zona, // Guarda la zona normalizada
            pileta: pileta,
            numero: cancha,
            material: material,
            turno: turno, 
            user_id: currentUser.id,
            nombre_usuario: userName 
        };
    }
    
    let error = null;
    if (isUpdate) {
        const result = await supabaseClient
            .from(tabla)
            .update(objetoRegistro)
            .eq('id', recordIdToModify);
        error = result.error;
    } else {
        const result = await supabaseClient
            .from(tabla)
            .insert([objetoRegistro]);
        error = result.error;
    }

    if (error) {
        console.error("Error al guardar/actualizar en Supabase:", error);
        showAlertModal(`Error al guardar: ${error.message}`);
        return;
    }

    mostrarToast(isUpdate ? "Registro modificado correctamente." : "Datos guardados correctamente", isUpdate ? 'yellow' : 'blue');
    
    // Llamar a cancelarModificacion después de guardar
    cancelarModificacion();
    
    // Recargar la vista activa para ver el cambio de orden de la tarjeta
    const activeTab = document.querySelector('.bg-mining-900 .bg-mining-accent');
    if (activeTab) {
        const tabName = activeTab.id.replace('btn', '').toLowerCase();
        // Si estamos en la pestaña de carga, recargamos la visualización detallada por defecto.
        if (tabName === 'carga') { 
            cambiarPestana('visualizacion');
        } else {
            cambiarPestana(tabName);
        }
    }
}

async function eliminarRegistroMuro(zona, muroId, recordId, shouldRerender = true) {
    if (!currentUser) return showAlertModal("Error: Debe iniciar sesión para eliminar datos.");
    
    const { error } = await supabaseClient
        .from('muros_registros')
        .delete()
        .eq('id', recordId); 
    
    if (error) {
        console.error("Error al eliminar muro:", error);
        return showAlertModal(`Error al eliminar muro: ${error.message}`);
    }

    if (shouldRerender) {
        const activeTab = document.querySelector('.bg-mining-900 .bg-mining-accent');
        const tabName = activeTab.id.replace('btn', '').toLowerCase();
        cambiarPestana(tabName); 
        mostrarToast("Registro de muro eliminado correctamente.", 'red');
    }
}

async function eliminarRegistroCancha(zona, recordId) {
    if (!currentUser) return showAlertModal("Error: Debe iniciar sesión para eliminar datos.");
    
    const { error } = await supabaseClient
        .from('canchas_registros')
        .delete()
        .eq('id', recordId); 
    
    if (error) {
        console.error("Error al eliminar cancha:", error);
        return showAlertModal(`Error al eliminar cancha: ${error.message}`);
    }

    const activeTab = document.querySelector('.bg-mining-900 .bg-mining-accent');
    const tabName = activeTab.id.replace('btn', '').toLowerCase();
    cambiarPestana(tabName); 
    mostrarToast("Registro de cancha eliminado correctamente.", 'red');
}

// --- Funciones de RENDERIZADO de Reporte Detallado ---

async function renderizarDatosReporte() {
    const { reporteDetallado: datosDB } = await obtenerDatos(); 
    const logActividad = await obtenerLogActividadGlobal(); 
    const zonas = Object.keys(datosDB).sort(); // Ordenar alfabéticamente para filtros

    let totalCount = 0;
    zonas.forEach(zona => {
        const dataZona = datosDB[zona];
        if(dataZona.canchas) totalCount += dataZona.canchas.length;
        if(dataZona.muros) {
            Object.values(dataZona.muros).forEach(arr => totalCount += arr.length);
        }
    });
    document.getElementById('totalRegistros').innerText = totalCount;

    if (zonas.length === 0) {
        // Si no hay zonas, aún queremos mostrar el log si tiene datos
        if (logActividad.length > 0) {
            document.getElementById('zoneFilterContainer').innerHTML = ''; 
            document.getElementById('dashboardContainer').innerHTML = generarTarjetaLog(logActividad); 
            return;
        }

        // Si no hay nada, mostrar mensaje de vacío
        document.getElementById('zoneFilterContainer').innerHTML = ''; 
        document.getElementById('dashboardContainer').innerHTML = `
            <div class="text-center py-20 text-slate-600 col-span-1">
                <i class="fa-solid fa-layer-group text-6xl mb-4 opacity-20"></i>
                <p>No hay registros cargados aún.</p>
                <p class="text-sm mt-2">Utilice el Menú de Carga para ingresar datos.</p>
            </div>`;
        return;
    }

    renderizarFiltrosReporte(zonas);
    
    if (!zonas.includes(currentReportZoneFilter) && currentReportZoneFilter !== 'TODOS') {
        currentReportZoneFilter = 'TODOS'; 
    }
    
    filtrarPorZonaReporte(currentReportZoneFilter, false, datosDB, logActividad); 
}

function renderizarFiltrosReporte(zonas) {
    const filterContainer = document.getElementById('zoneFilterContainer');
    let buttonsHtml = '';

    buttonsHtml += generarBotonFiltro('TODOS', currentReportZoneFilter === 'TODOS', 'filtrarPorZonaReporte');

    zonas.forEach(zona => {
        buttonsHtml += generarBotonFiltro(zona, currentReportZoneFilter === zona, 'filtrarPorZonaReporte');
    });

    filterContainer.innerHTML = buttonsHtml;
}

async function filtrarPorZonaReporte(zonaSeleccionada, updateFilterControls = true, datosDB = null, logActividad = null) {
    currentReportZoneFilter = zonaSeleccionada;
    
    if (!datosDB) datosDB = (await obtenerDatos()).reporteDetallado; 
    if (!logActividad) logActividad = await obtenerLogActividadGlobal(); 
    
    renderizarContenidoReporte(zonaSeleccionada, datosDB, logActividad); 
    
    if (updateFilterControls) {
        actualizarEstilosFiltro('zoneFilterContainer', zonaSeleccionada);
    }
}

/**
 * Renderiza el contenido del dashboard, con ordenamiento por fecha de última carga.
 */
function renderizarContenidoReporte(zonaSeleccionada, datosDB, logActividad) { 
    const container = document.getElementById('dashboardContainer');
    
    let zonas = Object.keys(datosDB);

    if (zonas.length === 0 && logActividad.length === 0) {
        container.innerHTML = `<div class="text-center py-10 text-slate-500 italic">No hay registros cargados aún.</div>`;
        return;
    }
    
    // 1. GENERAR EL LOG DE ACTIVIDAD (Siempre visible en 'TODOS')
    let logHtml = '';
    if (zonaSeleccionada === 'TODOS' && logActividad.length > 0) {
        logHtml = generarTarjetaLog(logActividad);
    }

    // 2. FILTRADO (si no es 'TODOS')
    let zonasAProcesar = zonas;
    if (zonaSeleccionada !== 'TODOS') {
        zonasAProcesar = zonas.filter(zona => zona === zonaSeleccionada);
    }
    
    if (zonasAProcesar.length === 0 && zonaSeleccionada !== 'TODOS') {
        container.innerHTML = `<p class="text-center py-10 text-slate-500 italic">No hay registros para la zona seleccionada (${zonaSeleccionada}).</p>`;
        return;
    }

    // 3. ORDENAMIENTO DE LAS TARJETAS (solo si el filtro es 'TODOS')
    if (zonaSeleccionada === 'TODOS') {
        zonasAProcesar.sort((zonaA, zonaB) => {
            const fechaA = datosDB[zonaA].ultimaFecha || new Date(0);
            const fechaB = datosDB[zonaB].ultimaFecha || new Date(0);
            
            // Orden descendente (fecha más nueva primero)
            return fechaB - fechaA; 
        });
    }

    // 4. RENDERIZADO
    container.innerHTML = logHtml; // <-- Colocar el Log primero
    zonasAProcesar.forEach(zona => {
        const dataZona = datosDB[zona];
        if (dataZona) {
            const cardHtml = generarTarjetaZona(zona, dataZona);
            container.innerHTML += cardHtml; 
        }
    });
}

// --- Funciones de RENDERIZADO de Muros (Perfil) ---

/**
 * Genera el SVG con la forma de tronco de pirámide invertida (muro).
 */
function generarSvgMuro(claveMuro) {
    const NUM_CAPAS = 7;
    const width = 200;
    const height = 240;
    const topWidth = 50; 
    const bottomWidth = 200; 
    
    const titleHeight = 25; 
    const drawableHeight = height - titleHeight;
    const capaHeight = drawableHeight / NUM_CAPAS;
    
    const capasPuntos = [];
    
    for (let i = 0; i < NUM_CAPAS; i++) {
        const y_top = titleHeight + i * capaHeight;
        const y_bottom = titleHeight + (i + 1) * capaHeight;
        
        const factor_top = i / NUM_CAPAS; 
        const factor_bottom = (i + 1) / NUM_CAPAS;
        
        const figura_ancho_top = topWidth + (bottomWidth - topWidth) * factor_top;
        const figura_ancho_bottom = topWidth + (bottomWidth - topWidth) * factor_bottom;

        const x1_top = (width - figura_ancho_top) / 2;
        const x2_top = x1_top + figura_ancho_top;
        
        const x1_bottom = (width - figura_ancho_bottom) / 2;
        const x2_bottom = x1_bottom + figura_ancho_bottom;
        
        capasPuntos.push(`M ${x1_bottom} ${y_bottom} L ${x2_bottom} ${y_bottom} L ${x2_top} ${y_top} L ${x1_top} ${y_top} Z`);
    }

    const NOMBRES_CAPAS_SVG = [
        { id: 'capa-6', label: '6', dbKey: '6' },         
        { id: 'capa-5', label: '5', dbKey: '5' },         
        { id: 'capa-4', label: '4', dbKey: '4' },         
        { id: 'capa-3', label: '3', dbKey: '3' },         
        { id: 'capa-2', label: '2', dbKey: '2' },         
        { id: 'capa-1', label: '1', dbKey: '1' },         
        { id: 'capa-basal', label: 'Basal', dbKey: 'BASAL' },
    ];

    // Generar un ID limpio y consistente.
    const safeClaveMuro = claveMuro.replace(/[^A-Z0-9]/g, '_');


    let svgContent = `<svg viewBox="0 0 ${width} ${height}" class="w-full" style="max-width: ${width}px; margin: 0 auto; display: block;">`;
    
    // Título CENTRADO (x="width / 2")
    svgContent += `
        <text x="${width / 2}" y="15" 
            text-anchor="middle" 
            font-size="12" 
            font-weight="bold"
            fill="#e2e8f0" 
            class="pointer-events-none">
            ${claveMuro}
        </text>
    `;
    
    // Separador
    svgContent += `<rect x="0" y="${titleHeight - 5}" width="${width}" height="1" fill="#475569"/>`;

    // Renderizar las capas PATH
    NOMBRES_CAPAS_SVG.forEach((capaInfo, i) => {
        svgContent += `
            <path 
                id="${safeClaveMuro}-${capaInfo.id}" 
                d="${capasPuntos[i]}" 
                class="svg-capa"
                data-capa-db="${capaInfo.dbKey}"
            />
        `;
    });
    
    // Renderizar las etiquetas de capa (Basal, 1, 2, etc.) en el centro
    for (let i = 0; i < NUM_CAPAS; i++) {
        const yCenter = titleHeight + (i + 0.5) * capaHeight; 
        
        const factor_center = (i + 0.5) / NUM_CAPAS;
        const figura_ancho_center = topWidth + (bottomWidth - topWidth) * factor_center;
        const xCenter = (width - figura_ancho_center) / 2 + (figura_ancho_center / 2);

        let label = NOMBRES_CAPAS_SVG[i].label;
        
        svgContent += `
            <text x="${xCenter}" y="${yCenter + 3}" 
                text-anchor="middle" 
                font-size="8" 
                fill="#0f172a" 
                class="pointer-events-none font-bold opacity-70">
                ${label}
            </text>
        `;
    }

    svgContent += `</svg>`;
    return svgContent;
}

/**
 * Determina el estado visual real de una capa aplicando la lógica de jerarquía.
 * (Si una capa superior está registrada, las inferiores se consideran 'completa').
 */
function obtenerEstadoVisualCapa(capaDbKey, capasEstado) {
    const indiceCapaActual = CAPAS_ORDENADAS.indexOf(capaDbKey);
    let indiceCapaParcialMasAlta = -1;
    let indiceCapaCompletaMasAlta = -1;

    // 1. Identificar el índice de la Capa registrada más alta
    CAPAS_ORDENADAS.forEach((dbKey, index) => {
        const estado = capasEstado[dbKey.toUpperCase()]?.estado;
        if (estado === 'parcial') {
            indiceCapaParcialMasAlta = Math.max(indiceCapaParcialMasAlta, index);
        }
        if (estado === 'completa') {
            indiceCapaCompletaMasAlta = Math.max(indiceCapaCompletaMasAlta, index);
        }
    });

    const indiceReferencia = Math.max(indiceCapaParcialMasAlta, indiceCapaCompletaMasAlta);
    
    // 2. Si la capa actual está por debajo del registro más alto
    if (indiceCapaActual < indiceReferencia) {
        return 'completa';
    }
    
    // 3. Si la capa actual es la capa parcial más alta, respeta el estado 'parcial'
    if (indiceCapaActual === indiceCapaParcialMasAlta && indiceCapaParcialMasAlta > indiceCapaCompletaMasAlta) {
        return 'parcial';
    }

    // 4. Si la capa actual es el registro más alto (o igual), devuelve su estado registrado
    if (indiceCapaActual === indiceReferencia) {
         return capasEstado[capaDbKey.toUpperCase()]?.estado || 'sin datos';
    }

    // 5. Por defecto (capa superior sin registro)
    return capasEstado[capaDbKey.toUpperCase()]?.estado || 'sin datos';
}


/**
 * Aplica color a las capas SVG, aplicando la regla de herencia y agregando el evento de click.
 */
function aplicarColorMuro(claveMuro, capasEstado, murosDetalle) {
    const safeClaveMuro = claveMuro.replace(/[^A-Z0-9]/g, '_'); 
    const muroData = murosDetalle[claveMuro];
    
    let indiceCapaParcialMasAlta = -1;
    let indiceCapaCompletaMasAlta = -1;

    // 1. Identificar el índice de la Capa 'PARCIAL' y 'COMPLETA' más alta.
    CAPAS_ORDENADAS.forEach((dbKey, index) => {
        const estado = capasEstado[dbKey.toUpperCase()]?.estado;
        if (estado === 'parcial') {
            indiceCapaParcialMasAlta = Math.max(indiceCapaParcialMasAlta, index);
        }
        if (estado === 'completa') {
            indiceCapaCompletaMasAlta = Math.max(indiceCapaCompletaMasAlta, index);
        }
    });
    
    // La Capa de Referencia es el índice de registro más alto, sea parcial o completa.
    const indiceReferencia = Math.max(indiceCapaParcialMasAlta, indiceCapaCompletaMasAlta);

    // 2. Recorrer todas las capas en el orden (Basal a 6)
    CAPAS_ORDENADAS.forEach((dbKey, index) => {
        const svgId = CAPA_SVG_MAP[dbKey];
        const elementId = `${safeClaveMuro}-${svgId}`;
        const capaElement = document.getElementById(elementId);
        
        if (capaElement) {
            capaElement.classList.remove('color-parcial', 'color-completa');
            capaElement.removeAttribute('onclick'); // Limpiar el onclick
            
            let estadoVisual = capasEstado[dbKey.toUpperCase()]?.estado; // Estado registrado
            let registroID = capasEstado[dbKey.toUpperCase()]?.recordId; // ID del registro que lo causó

            // 3. Aplicar Lógica de Herencia/Jerarquía
            
            // Si la capa actual (index) está estrictamente por debajo del registro más alto (indiceReferencia), 
            // se muestra como COMPLETA (verde).
            if (index < indiceReferencia) {
                estadoVisual = 'completa';
                // El registroID se mantiene solo si es el que lo causó directamente.
            }
            
            // Excepción: Si estamos en la capa parcial más alta, debe mantener su color amarillo.
            if (index === indiceCapaParcialMasAlta && indiceCapaParcialMasAlta > indiceCapaCompletaMasAlta) {
                estadoVisual = 'parcial';
            }
            
            // 4. Aplicar el color visual Y el evento de click (solo si tiene registro directo)
            if (estadoVisual === 'parcial') {
                capaElement.classList.add('color-parcial');
            } else if (estadoVisual === 'completa') {
                capaElement.classList.add('color-completa');
            }

            // AÑADIR EVENTO DE CLICK (Solo a las capas con registro directo)
            if (registroID) {
                capaElement.title = `Clic para editar: Capa ${dbKey} (${estadoVisual.toUpperCase()})`;
                const zonaMuro = muroData.zona;
                const muroName = claveMuro.split(' - ')[1];
                // Usamos el ID del registro que originó ese estado.
                capaElement.setAttribute('onclick', `mostrarModalEdicion('${zonaMuro}', '${muroName}', '${registroID}')`);
            } else {
                 capaElement.title = `Capa ${dbKey} (${estadoVisual ? estadoVisual.toUpperCase() : 'SIN DATOS'})`;
            }
        }
    });
}

/**
 * Renderiza la vista de Perfil de Muros (SVG) y sus filtros.
 */
async function renderizarMuros() {
    const { perfilesMuros: muros } = await obtenerDatos(); 
    const dashboard = document.getElementById('murosDashboard');
    
    // Obtener todas las zonas únicas de los muros (ya están normalizadas)
    const zonasUnicas = [...new Set(Object.values(muros).map(m => m.zona))].sort();
    
    if (Object.keys(muros).length === 0) {
        dashboard.innerHTML = `
            <div class="text-center py-20 text-slate-600 col-span-full">
                <i class="fa-solid fa-ruler-combined text-6xl mb-4 opacity-20"></i>
                <p>No hay registros de muros cargados aún.</p>
            </div>`;
        document.getElementById('murosZoneFilterContainer').innerHTML = '';
        return;
    }
    
    // 1. Renderizar Filtros
    renderizarFiltrosMuros(zonasUnicas);
    
    // 2. Aplicar Filtro
    if (!zonasUnicas.includes(currentMurosZoneFilter) && currentMurosZoneFilter !== 'TODOS') {
        currentMurosZoneFilter = 'TODOS'; 
    }
    filtrarPorZonaMuros(currentMurosZoneFilter, false, muros);
}

/**
 * Renderiza los botones de filtro para la vista de Muros.
 */
function renderizarFiltrosMuros(zonas) {
    const filterContainer = document.getElementById('murosZoneFilterContainer');
    let buttonsHtml = '';

    buttonsHtml += generarBotonFiltro('TODOS', currentMurosZoneFilter === 'TODOS', 'filtrarPorZonaMuros');

    zonas.forEach(zona => {
        buttonsHtml += generarBotonFiltro(zona, currentMurosZoneFilter === zona, 'filtrarPorZonaMuros');
    });

    filterContainer.innerHTML = buttonsHtml;
}

/**
 * Filtra y renderiza los muros según la zona seleccionada.
 */
async function filtrarPorZonaMuros(zonaSeleccionada, updateFilterControls = true, muros = null) {
    currentMurosZoneFilter = zonaSeleccionada;
    
    if (!muros) muros = (await obtenerDatos()).perfilesMuros; 
    const dashboard = document.getElementById('murosDashboard');
    dashboard.innerHTML = '';
    
    const murosFiltrados = Object.entries(muros)
        .filter(([clave, data]) => zonaSeleccionada === 'TODOS' || data.zona === zonaSeleccionada)
        .sort(([, dataA], [, dataB]) => {
            // Ordenar por fecha más reciente primero (DESCENDENTE)
            const fechaA = dataA.ultimaFecha || new Date(0);
            const fechaB = dataB.ultimaFecha || new Date(0);
            
            if (fechaB - fechaA !== 0) {
                return fechaB - fechaA; // Ordena por fecha
            }
            
            // Si las fechas son iguales, usar el orden alfanumérico como desempate.
            const claveA = `${dataA.zona} - ${Object.keys(dataA.capasEstado)[0] || ''}`; // Desempate alfanumérico
            const claveB = `${dataB.zona} - ${Object.keys(dataB.capasEstado)[0] || ''}`;
            return compareAlphanumeric({ capa: claveA }, { capa: claveB });
        });
    
    if (murosFiltrados.length === 0) {
         dashboard.innerHTML = `
            <div class="text-center py-20 text-slate-600 col-span-full">
                <i class="fa-solid fa-mountain-sun text-6xl mb-4 opacity-20"></i>
                <p>No hay muros en la zona seleccionada (${zonaSeleccionada}).</p>
            </div>`;
    } else {
        murosFiltrados.forEach(([claveMuro, dataMuro]) => {
            let html = `
                <div class="bg-mining-800 rounded-xl p-4 border border-mining-700 shadow-lg fade-in">
                    <div class="svg-container relative">
                        ${generarSvgMuro(claveMuro)}
                    </div>
                    
                    <div class="mt-4 border-t border-mining-700 pt-3">
                        <p class="text-xs text-slate-400 font-semibold mb-1">Últimos Registros (por Capa):</p>
                        ${CAPAS_ORDENADAS.filter(capaDbKey => dataMuro.capasEstado[capaDbKey] || obtenerEstadoVisualCapa(capaDbKey, dataMuro.capasEstado) === 'completa')
                           .sort(compareAlphanumeric).map(capaDbKey => {
                            
                            // 1. Determinar el estado visual real (aplicando la jerarquía)
                            const estadoVisual = obtenerEstadoVisualCapa(capaDbKey, dataMuro.capasEstado);
                            
                            // 2. Elegir el estilo según el estado visual
                            const colorClass = estadoVisual === 'parcial' 
                                ? 'text-yellow-400' 
                                : 'text-green-400';
                            
                            // 3. Mostrar el estado visual calculado
                            return `
                                <div class="flex justify-between text-xs text-slate-300">
                                    <span>Capa ${capaDbKey}:</span>
                                    <span class="${colorClass} font-bold uppercase">${estadoVisual}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
            dashboard.innerHTML += html;
            
            // Asegurar que el SVG se coloree después de estar en el DOM
            setTimeout(() => aplicarColorMuro(claveMuro, dataMuro.capasEstado, muros), 0);
        });
    }

    if (updateFilterControls) {
        actualizarEstilosFiltro('murosZoneFilterContainer', zonaSeleccionada);
    }
}

// --- Funciones de RENDERIZADO COMUNES ---

/**
 * Genera un botón de filtro con el manejador de clic correcto.
 */
function generarBotonFiltro(zona, isActive, handlerFunction) {
    const activeClass = 'bg-mining-accent text-white shadow-md';
    const inactiveClass = 'bg-mining-900 text-slate-400 hover:bg-mining-700/50 hover:text-white border border-mining-700';

    return `
        <button onclick="${handlerFunction}('${zona}')" class="px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${isActive ? activeClass : inactiveClass}">
            ${zona}
        </button>
    `;
}

/**
 * Actualiza los estilos de los botones de filtro.
 */
function actualizarEstilosFiltro(containerId, zonaSeleccionada) {
     const filterContainer = document.getElementById(containerId);
     const activeClass = 'bg-mining-accent text-white shadow-md';
     const inactiveClass = 'bg-mining-900 text-slate-400 hover:bg-mining-700/50 hover:text-white border border-mining-700';

     filterContainer.querySelectorAll('button').forEach(btn => {
        const zonaBtn = btn.innerText.trim();
        
        if (zonaBtn === zonaSeleccionada) {
            btn.classList.remove(...inactiveClass.split(' '));
            btn.classList.add(...activeClass.split(' '));
        } else {
            btn.classList.remove(...activeClass.split(' '));
            btn.classList.add(...inactiveClass.split(' '));
        }
    });
}

function compareAlphanumeric(a, b) {
    // Si los argumentos son strings, los convierte a objetos para la comparación.
    const aStr = (typeof a === 'object' && a.capa) ? a.capa : a; 
    const bStr = (typeof b === 'object' && b.capa) ? b.capa : b; 
    
    // Si los argumentos son los nombres de las capas (e.g., 'BASAL', '1', '2'), usa el orden predefinido
    if (CAPAS_ORDENADAS.includes(aStr) && CAPAS_ORDENADAS.includes(bStr)) {
        return CAPAS_ORDENADAS.indexOf(aStr) - CAPAS_ORDENADAS.indexOf(bStr);
    }

    // Comparación alfanumérica estándar para otros casos (e.g., clave de muro)
    const regex = /(\d+)|(\D+)/g;
    const partsA = (aStr.match(regex) || []).filter(p => p.trim() !== '');
    const partsB = (bStr.match(regex) || []).filter(p => p.trim() !== '');

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const partA = partsA[i] || '';
        const partB = partsB[i] || '';

        const isNumberA = /^\d+$/.test(partA);
        const isNumberB = /^\d+$/.test(partB);

        if (isNumberA && isNumberB) {
            const numA = parseInt(partA);
            const numB = parseInt(partB);
            if (numA !== numB) return numA - numB;
        } else if (partA !== partB) {
            if (partA < partB) return -1;
            if (partA > partB) return 1;
        }
    }
    return 0;
}

/**
 * Genera la tarjeta de zona e incluye la lógica del tag "NUEVO" para cada registro.
 */
function generarTarjetaZona(zona, dataZona) {
    const tieneMuros = dataZona.muros && Object.keys(dataZona.muros).length > 0;
    const tieneCanchas = dataZona.canchas && dataZona.canchas.length > 0;
    const totalMuros = tieneMuros ? Object.keys(dataZona.muros).length : 0;
    const totalCanchas = tieneCanchas ? dataZona.canchas.length : 0;
    const ultimaFecha = dataZona.ultimaFecha ? `(Última carga: ${dataZona.ultimaFecha.toLocaleDateString()} ${dataZona.ultimaFecha.toLocaleTimeString()})` : '';

    let html = `
        <div class="bg-mining-800 rounded-xl border border-mining-700 shadow-xl overflow-hidden fade-in">
            <div class="bg-gradient-to-r from-mining-700 to-mining-800 p-4 border-b border-mining-700 flex justify-between items-center">
                <h3 class="text-lg font-bold text-white tracking-wide"><i class="fa-solid fa-map-location-dot mr-2 text-slate-400"></i> ${zona}</h3>
                <span class="text-xs text-slate-400 italic">${ultimaFecha}</span>
            </div>
            <div class="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
    `;

    // --- COLUMNA MUROS ---
    html += `<div class="space-y-4">
                <h4 class="text-xs font-bold text-slate-400 uppercase border-b border-mining-700 pb-2 mb-4">
                    <i class="fa-solid fa-block-brick mr-1"></i> Muros (${totalMuros})
                </h4>`;
    
    if (tieneMuros) {
        Object.keys(dataZona.muros).sort().forEach(muroNombre => {
            html += `
                <div class="bg-mining-900 rounded border border-mining-700 overflow-hidden">
                    <h5 class="font-bold text-slate-200 p-3 bg-mining-700/50 border-b border-mining-700 text-sm">${muroNombre}</h5>
                    <div class="divide-y divide-mining-700">`;
            
            // Ordenar registros de Muro por fecha DESC
            dataZona.muros[muroNombre].sort((a, b) => b.fechaRaw - a.fechaRaw).forEach(capa => {
                const colorClass = capa.estado === 'completa' 
                    ? 'text-mining-success bg-green-900/10 border-green-800' 
                    : 'text-mining-warning bg-yellow-900/10 border-yellow-800';
                
                const userDisplay = capa.nombreUsuario || 'SIN REGISTRO';
                
                const tagNuevo = esRegistroNuevo(capa.fechaRaw) 
                    ? '<span class="tag-nuevo">NUEVO</span>' 
                    : '';
                
                html += `
                    <div class="flex items-center justify-between px-4 py-3 hover:bg-mining-700/20 transition-colors">
                        <div class="flex flex-col">
                            <span class="text-xs font-mono rounded border ${colorClass} px-2 py-0.5 inline-block w-fit font-bold">CAPA ${capa.capa} (${capa.estado.toUpperCase()})${tagNuevo}</span>
                            
                            <span class="text-xs text-slate-500 mt-1">
                                <i class="fa-solid fa-user-gear mr-1"></i> 
                                <span class="font-bold text-slate-400">${userDisplay}</span> | Turno: ${capa.turno}
                            </span>
                            
                            <span class="text-xs text-slate-500 mt-1"><i class="fa-regular fa-clock mr-1"></i> ${capa.fecha}</span>
                        </div>
                        <div class="flex gap-1 text-right">
                            <button onclick="mostrarModalEdicion('${zona}', '${muroNombre}', '${capa.id}')" class="text-base text-yellow-500 hover:text-yellow-400 p-1 rounded-full transition-colors" title="Modificar">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button onclick="mostrarModalEliminarMuro('${zona}', '${muroNombre}', '${capa.id}')" class="text-base text-red-500 hover:text-red-400 p-1 rounded-full transition-colors" title="Eliminar">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </div>
                `;
            });
            html += `</div></div>`;
        });
    } else {
        html += `<p class="text-sm text-slate-600 italic">Sin registros de muros.</p>`;
    }
    html += `</div>`; // Fin columna muros

    // --- COLUMNA CANCHAS ---
    html += `<div class="space-y-4">
                <h4 class="text-xs font-bold text-slate-400 uppercase border-b border-mining-700 pb-2 mb-4">
                    <i class="fa-solid fa-mountain-sun mr-1"></i> Canchas (${totalCanchas})
                </h4>`;
    
    if (tieneCanchas) {
        html += `<div class="space-y-2">`;
        
        // Ordenar registros de Cancha por fecha DESC
        dataZona.canchas.sort((a, b) => b.fechaRaw - a.fechaRaw).forEach(cancha => {
            const nombreCompleto = `${cancha.pileta} / ${cancha.numero}`;
            const materialColorClass = cancha.material === 'FINO'
                ? 'bg-blue-900/20 text-blue-300 border-blue-800'
                : 'bg-orange-900/20 text-orange-300 border-orange-800';
                
            const userDisplay = cancha.nombreUsuario || 'SIN REGISTRO';
            
            const tagNuevo = esRegistroNuevo(cancha.fechaRaw) 
                ? '<span class="tag-nuevo ml-2">NUEVO</span>' 
                : '';

            html += `
                <div class="flex items-center justify-between bg-mining-900 p-3 rounded border border-mining-700 hover:bg-mining-700/20 transition-colors">
                    <div class="flex-1 min-w-0">
                        <span class="block text-sm font-bold text-slate-200 truncate">${nombreCompleto}${tagNuevo}</span>
                        
                        <span class="text-xs px-2 py-0.5 rounded-full font-bold border ${materialColorClass} inline-block mt-1 mr-2">
                            ${cancha.material}
                        </span>
                        
                        <span class="block text-xs text-slate-500 mt-1">
                            <i class="fa-solid fa-user-gear mr-1"></i> 
                            <span class="font-bold text-slate-400">${userDisplay}</span> | Turno: ${cancha.turno}
                        </span>

                        <span class="block text-xs text-slate-500 mt-1"><i class="fa-regular fa-clock mr-1"></i> ${cancha.fecha}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="mostrarModalEdicionCancha('${zona}', '${cancha.id}')" class="text-base text-yellow-500 hover:text-yellow-400 p-1 rounded-full transition-colors" title="Modificar">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button onclick="mostrarModalEliminarCancha('${zona}', '${cancha.id}', '${nombreCompleto}')" class="text-base text-red-500 hover:text-red-400 p-1 rounded-full transition-colors" title="Eliminar">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    } else {
        html += `<p class="text-sm text-slate-600 italic">Sin registros de canchas.</p>`;
    }
    html += `</div>`; 

    html += `</div></div>`; 
    return html;
}

/**
 * Genera la tarjeta de log de actividad con las últimas 10 entradas.
 */
function generarTarjetaLog(logActividad) {
    if (logActividad.length === 0) return '';

    let itemsHtml = logActividad.map(log => {
        const iconClass = log.tipo === 'Muro' ? 'fa-solid fa-block-brick' : 'fa-solid fa-mountain-sun';
        const colorClass = log.tipo === 'Muro' ? 'text-blue-400' : 'text-orange-400';
        
        // Formato de hora: 10:30:15 PM
        const timeStr = log.fecha.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        
        return `
            <div class="flex items-start p-3 bg-mining-900/50 rounded-lg border border-mining-700 hover:bg-mining-700/50 transition-colors">
                <i class="${iconClass} ${colorClass} text-xl mr-3 mt-1 flex-shrink-0"></i>
                <div class="flex-grow min-w-0">
                    <p class="text-sm font-bold text-white truncate">${log.detalle}</p>
                    <div class="text-xs text-slate-400 mt-1 flex justify-between items-center">
                        <span class="font-semibold text-slate-300"><i class="fa-solid fa-user mr-1"></i> ${log.usuario}</span>
                        <span><i class="fa-regular fa-clock mr-1"></i> ${timeStr}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // **IMPORTANTE**: La clase "col-span-1 lg:col-span-2" hace que ocupe todo el ancho.
    return `
        <div class="bg-mining-800 rounded-xl border border-mining-700 shadow-xl overflow-hidden fade-in col-span-1 lg:col-span-2"> 
            <div class="bg-gradient-to-r from-slate-700 to-mining-800 p-4 border-b border-mining-700 flex justify-between items-center">
                <h3 class="text-lg font-bold text-white tracking-wide"><i class="fa-solid fa-list-check mr-2 text-slate-400"></i> Últimas 10 Actividades Globales</h3>
                <span class="text-xs text-slate-400 italic">Más reciente primero</span>
            </div>
            <div class="p-4 space-y-3">
                ${itemsHtml}
            </div>
        </div>
    `;
}


// --- Funciones auxiliares (Modales y Formulario) ---

function showAlertModal(message) {
    document.getElementById('alertMessage').innerText = message;
    document.getElementById('alertModal').classList.replace('hidden', 'flex');
}

function hideAlertModal() {
    document.getElementById('alertModal').classList.replace('flex', 'hidden');
}

function mostrarActionModal(title, message, confirmText, callback) {
    const modal = document.getElementById('actionConfirmationModal');
    document.getElementById('actionModalTitle').innerText = title;
    document.getElementById('actionModalMessage').innerHTML = message;
    document.getElementById('actionModalConfirmBtn').innerText = confirmText;
    
    const confirmBtn = document.getElementById('actionModalConfirmBtn');
    confirmBtn.onclick = () => {
        modal.classList.replace('flex', 'hidden');
        callback();
    };

    modal.classList.replace('hidden', 'flex');
}

function mostrarModalEliminarCancha(zona, recordId, nombreCompleto) {
    mostrarActionModal(
        'Eliminar Registro',
        `¿Deseas eliminar el registro de cancha **${nombreCompleto}** en la zona **${zona}**?`,
        'Eliminar',
        () => eliminarRegistroCancha(zona, recordId) 
    );
}

function mostrarModalLimpiarDB() {
    mostrarActionModal(
        'Confirmar Eliminación',
        '¿Estás seguro de que deseas borrar <span class="font-bold text-white">todos</span> los datos de obra? Esta acción no se puede deshacer.',
        'Sí, Borrar Todo',
        limpiarDB
    );
}

function mostrarModalEliminarMuro(zona, muroId, recordId) {
    mostrarActionModal(
        'Eliminar Registro',
        `¿Deseas eliminar el registro de muro **${muroId}** en la zona **${zona}**?`,
        'Eliminar',
        () => eliminarRegistroMuro(zona, muroId, recordId)
    );
}

function handleChecks(seleccion) {
    const parcial = document.getElementById('checkParcial');
    const completa = document.getElementById('checkCompleta');

    if (seleccion === 'parcial' && parcial.checked) {
        completa.checked = false;
    } else if (seleccion === 'completa' && completa.checked) {
        parcial.checked = false;
    }
}

function toggleForm() {
    const tipo = document.getElementById('selectTipo').value;
    const form = document.getElementById('dataForm');
    const fieldsMuro = document.getElementById('fieldsMuro');
    const fieldsCancha = document.getElementById('fieldsCancha');

    form.classList.remove('hidden');
    
    // Limpiar y resetear IDs de edición al cambiar el tipo (a menos que se esté en edición)
    if (!document.getElementById('recordIdToModify').value) {
        document.getElementById('dataForm').reset();
        document.getElementById('cargaTitle').innerText = 'Menú de Carga';
        document.getElementById('modificationHint').classList.add('hidden');
        document.getElementById('cancelModificationBtn').classList.add('hidden'); // Ocultar si no hay edición
    }

    if (tipo === 'muro') {
        fieldsMuro.classList.remove('hidden');
        fieldsCancha.classList.add('hidden');
        document.getElementById('muroZona').setAttribute('required', '');
        document.getElementById('muroCapa').setAttribute('required', '');
        document.getElementById('muroId').setAttribute('required', '');
        document.getElementById('canchaZona').removeAttribute('required');
        document.getElementById('canchaPileta').removeAttribute('required');
        document.getElementById('canchaNumero').removeAttribute('required');

    } else {
        fieldsMuro.classList.add('hidden');
        fieldsCancha.classList.remove('hidden');
        document.getElementById('muroZona').removeAttribute('required');
        document.getElementById('muroCapa').removeAttribute('required');
        document.getElementById('muroId').removeAttribute('required');
        document.getElementById('canchaZona').setAttribute('required', '');
        document.getElementById('canchaPileta').setAttribute('required', '');
        document.getElementById('canchaNumero').setAttribute('required', '');
    }
}

/**
 * Cancela el modo de modificación y vuelve al modo de carga normal.
 */
function cancelarModificacion() {
    // 1. Resetear el formulario y los campos ocultos
    document.getElementById('dataForm').reset();
    document.getElementById('recordIdToModify').value = "";
    document.getElementById('originalZona').value = "";
    
    // 2. Ocultar el botón de cancelar y la pista de modificación
    document.getElementById('cancelModificationBtn').classList.add('hidden');
    document.getElementById('modificationHint').classList.add('hidden');
    
    // 3. Restaurar el título
    document.getElementById('cargaTitle').innerText = 'Menú de Carga';
    
    // 4. Ocultar los campos de Muro/Cancha y el formulario principal, y resetear el selector de tipo
    document.getElementById('fieldsMuro').classList.add('hidden');
    document.getElementById('fieldsCancha').classList.add('hidden');
    document.getElementById('dataForm').classList.add('hidden');
    document.getElementById('selectTipo').value = "";
    
    // Asegurar que los checkboxes también se limpien
    document.getElementById('checkParcial').checked = false;
    document.getElementById('checkCompleta').checked = false;
}

/**
 * Lógica de edición para registros de Muros.
 */
async function mostrarModalEdicion(zona, muroId, recordId) {
    if (!currentUser) return showAlertModal("Error: Debe iniciar sesión para editar datos.");
    
    // 1. Consultar el registro específico
    const { data, error } = await supabaseClient
        .from('muros_registros')
        .select('id, zona, muro_id, capa, estado, turno')
        .eq('id', recordId)
        .single();

    if (error || !data) {
        console.error("Error al obtener registro para editar:", error);
        return showAlertModal("No se pudo cargar el registro para edición. Por favor, intente de nuevo.");
    }
    
    // 2. Preparar la vista de Carga
    cambiarPestana('carga'); 
    document.getElementById('selectTipo').value = 'muro';
    toggleForm(); // Muestra el formulario de muro

    // 3. Rellenar los campos
    document.getElementById('cargaTitle').innerText = 'Modificar Registro (Muro)';
    document.getElementById('modificationHint').classList.remove('hidden');
    document.getElementById('cancelModificationBtn').classList.remove('hidden'); 
    
    document.getElementById('recordIdToModify').value = data.id;
    document.getElementById('originalZona').value = data.zona; 
    
    document.getElementById('muroZona').value = data.zona;
    document.getElementById('muroId').value = data.muro_id;
    document.getElementById('muroCapa').value = data.capa;
    document.getElementById('selectTurno').value = data.turno;

    // 4. Rellenar los checkboxes
    const checkParcial = document.getElementById('checkParcial');
    const checkCompleta = document.getElementById('checkCompleta');
    
    checkParcial.checked = data.estado === 'parcial';
    checkCompleta.checked = data.estado === 'completa';
    handleChecks(data.estado); 
}

/**
 * Lógica de edición para registros de Canchas.
 */
async function mostrarModalEdicionCancha(zona, recordId) {
     if (!currentUser) return showAlertModal("Error: Debe iniciar sesión para editar datos.");
    
    // 1. Consultar el registro específico
    const { data, error } = await supabaseClient
        .from('canchas_registros')
        .select('id, zona, pileta, numero, material, turno')
        .eq('id', recordId)
        .single();

    if (error || !data) {
        console.error("Error al obtener registro para editar:", error);
        return showAlertModal("No se pudo cargar el registro para edición. Por favor, intente de nuevo.");
    }

    // 2. Preparar la vista de Carga
    cambiarPestana('carga');
    document.getElementById('selectTipo').value = 'cancha';
    toggleForm(); // Muestra el formulario de cancha

    // 3. Rellenar los campos
    document.getElementById('cargaTitle').innerText = 'Modificar Registro (Cancha)';
    document.getElementById('modificationHint').classList.remove('hidden');
    document.getElementById('cancelModificationBtn').classList.remove('hidden'); 

    document.getElementById('recordIdToModify').value = data.id;
    document.getElementById('originalZona').value = data.zona;

    document.getElementById('canchaZona').value = data.zona;
    document.getElementById('canchaPileta').value = data.pileta;
    document.getElementById('canchaNumero').value = data.numero;
    document.getElementById('canchaMaterial').value = data.material;
    document.getElementById('selectTurno').value = data.turno;
}

function mostrarToast(message = "Datos guardados correctamente", type = 'blue') {
    const toast = document.getElementById('toast');
    const icon = toast.querySelector('i');
    const span = toast.querySelector('span');

    toast.className = 'fixed bottom-5 right-5 text-white px-6 py-4 rounded shadow-2xl transform translate-y-20 opacity-0 transition-all duration-300 z-50 flex items-center gap-3';

    span.innerText = message;
    
    if (type === 'blue') {
        toast.classList.add('bg-mining-800', 'border-l-4', 'border-mining-accent');
        icon.className = 'fa-solid fa-circle-check text-mining-accent';
    } else if (type === 'red') {
        toast.classList.add('bg-red-800/80', 'border-l-4', 'border-red-500');
        icon.className = 'fa-solid fa-trash-can text-red-500';
    } else if (type === 'yellow') {
         toast.classList.add('bg-yellow-800/80', 'border-l-4', 'border-yellow-500');
        icon.className = 'fa-solid fa-pen-to-square text-yellow-500';
    }

    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0');
    }, 3000);
}

// Función de borrado total (solo para administración/desarrollo)
async function limpiarDB() {
    // Se debe establecer un correo específico para el administrador o un rol de administrador en Supabase
    if (!currentUser || currentUser.email !== 'admin@example.com') {
         return showAlertModal("Acceso denegado: Solo el administrador puede ejecutar esta acción.");
    }
    
    const { error: errorMuros } = await supabaseClient.from('muros_registros').delete().neq('id', 0);
    const { error: errorCanchas } = await supabaseClient.from('canchas_registros').delete().neq('id', 0);

    if (errorMuros || errorCanchas) {
        console.error("Error al limpiar DB:", errorMuros || errorCanchas);
        showAlertModal(`Error al limpiar la base de datos: ${errorMuros?.message || errorCanchas?.message}`);
    } else {
        mostrarToast("Base de datos limpiada completamente.", 'red');
        cambiarPestana('visualizacion'); // Recargar las vistas
    }
}
