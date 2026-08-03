const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * Obtiene la URL de descarga y descarga el archivo de los servidores de Meta.
 * Retorna el path local del archivo descargado.
 */
async function descargarMedia(mediaId) {
    try {
        console.log(`Descargando media ${mediaId}...`);
        
        // 1. Obtener la URL del objeto media
        const response = await axios({
            method: 'GET',
            url: `https://graph.facebook.com/v19.0/${mediaId}`,
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`
            }
        });

        const url = response.data.url;
        const mimeType = response.data.mime_type;
        const extension = mimeType.split('/')[1].split(';')[0]; // ej: ogg, jpeg
        
        const fileName = `media_${mediaId}.${extension}`;
        const filePath = path.join(__dirname, 'temp', fileName);

        // Crear carpeta temp si no existe
        if (!fs.existsSync(path.join(__dirname, 'temp'))) {
            fs.mkdirSync(path.join(__dirname, 'temp'));
        }

        // 2. Descargar el archivo binario
        const mediaResponse = await axios({
            method: 'GET',
            url: url,
            responseType: 'arraybuffer',
            headers: {
                'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`
            }
        });

        fs.writeFileSync(filePath, mediaResponse.data);
        console.log(`✅ Archivo descargado en: ${filePath}`);
        
        return { filePath, mimeType };
    } catch (error) {
        console.error('Error descargando media de WhatsApp:', error.message);
        return null;
    }
}

/**
 * Normaliza nombres de carpetas para evitar caracteres extraños en el sistema de archivos.
 */
function normalizarNombre(txt) {
    return String(txt || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .trim() || 'general';
}

/**
 * Almacena de forma PERMANENTE y ESTRUCTURADA un archivo en el VPS.
 * Crea un árbol por Administrador / Edificio / Tipo (facturas, audios, documentos).
 * 
 * Estructura: almacenamiento/[admin]/[edificio]/[tipo]/[archivo]
 */
function guardarArchivoEstructurado({ filePath, adminNombre, edificioNombre, tipo = 'documentos' }) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return null;

        const adminFolder    = normalizarNombre(adminNombre || 'administracion_general');
        const edificioFolder = normalizarNombre(edificioNombre || 'edificio_general');
        const tipoFolder     = normalizarNombre(tipo); // 'facturas', 'audios', 'documentos'

        const baseDir = path.join(__dirname, 'almacenamiento', adminFolder, edificioFolder, tipoFolder);
        
        // Crear carpetas recursivamente
        fs.mkdirSync(baseDir, { recursive: true });

        const fileName = path.basename(filePath);
        const targetPath = path.join(baseDir, fileName);

        // Copiar archivo a la carpeta permanente
        fs.copyFileSync(filePath, targetPath);

        const relativeUrl = `/archivos/${adminFolder}/${edificioFolder}/${tipoFolder}/${fileName}`;
        console.log(`📁 Archivo permanente guardado en: ${targetPath}`);
        console.log(`🌐 URL web asignada: ${relativeUrl}`);

        return { targetPath, relativeUrl };
    } catch (err) {
        console.error('Error guardando archivo estructurado:', err.message);
        return null;
    }
}

module.exports = { descargarMedia, guardarArchivoEstructurado, normalizarNombre };
