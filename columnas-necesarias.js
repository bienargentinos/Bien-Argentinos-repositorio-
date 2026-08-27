// Qué columnas necesita cada pestaña de Sheets para que no se pierda nada.
//
// Vive en su propio archivo porque lo usan tres lados: `revisar-columnas.js` (para decir qué
// falta), `crear-columnas.js` (para crearlas) y las pruebas. Tenerlo copiado en cada uno
// garantizaba que las listas se fueran separando con el tiempo -- que es exactamente la clase de
// problema que este archivo existe para evitar.
//
// SI UNA FUNCIÓN NUEVA DE `sheets.js` ESCRIBE UNA COLUMNA NUEVA, VA ACÁ TAMBIÉN. Si no, el
// diagnóstico va a decir que está todo bien mientras el dato se pierde.

module.exports = {
    // EVENTOS es la que se quedó sin lugar: 26 columnas de hoja y más de treinta necesarias.
    'EVENTOS': [
        'id_evento', 'fecha', 'edificio', 'vecino', 'depto', 'unidad', 'mensaje', 'tipo',
        'urgencia', 'estado', 'notas', 'feedback', 'telefono',
        // Sin estas tres el administrador ve un caso abierto y no tiene a quién llamar, y queda
        // muerta toda la lógica que depende del rubro.
        'tecnico', 'tel_tecnico', 'rubro_tecnico',
        'hora_fin', 'audio_url', 'transcripcion', 'historial_chat',
        'audios_json', 'involucrados_json', 'chat_vecino_json', 'chat_proveedor_json',
        // Marcas de "esto ya se hizo". Viven en la planilla y no en RAM porque PM2 reinicia
        // seguido: en RAM, un reinicio hace que se vuelva a mandar todo.
        'tecnico_notificado', 'admin_notificado', 'contacto_acceso_avisado',
        'material_enviado_tecnico', 'tecnico_confirmado', 'tecnico_eta',
        // El seguimiento: sin esto nadie vuelve a preguntar si el técnico fue.
        'proximo_seguimiento', 'seguimiento_paso', 'seguimiento_nota',
    ],

    // `id_evento` es lo único que ata una factura a su caso. Sin la columna, el administrador ve
    // un gasto suelto sin conversación, sin teléfono del técnico y sin nada que preguntarle.
    'facturas': [
        'fecha', 'proveedor', 'monto', 'concepto', 'edificio', 'url_archivo',
        'numero_factura', 'estado', 'nota_tecnico', 'enviada_por', 'id_evento',
    ],

    // Los datos de cobro. Sin estas columnas, todo lo que el técnico manda de CBU o alias se
    // guarda en el aire.
    'proveedores': [
        'cliente', 'rubro', 'nombre', 'telefono', 'notas', 'estado',
        'cbu', 'alias_cbu', 'titular', 'cuit', 'cbu_actualizado',
        'cbu_pendiente', 'alias_pendiente', 'cbu_pendiente_desde',
    ],

    'vecinos': ['telefono', 'nombre', 'edificio', 'autoriza_contacto', 'contacto_acceso'],

    // Lo que Marcos aprendió de las conversaciones sobre el edificio: quién tiene la llave de qué.
    'accesos': ['edificio', 'instalacion', 'quien_tiene', 'telefono', 'notas', 'fecha'],
};
