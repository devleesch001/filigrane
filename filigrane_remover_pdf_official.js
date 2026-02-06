document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('pdfFile');
    const canvas = document.getElementById('pdfPreview');
    const ctx = canvas.getContext('2d');
    const removeBtn = document.getElementById('removeWatermarkBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const resetBtn = document.getElementById('resetBtn');
    const statusDiv = document.getElementById('status');
    const watermarkInput = document.getElementById('watermarkText');
    const pdfjsLib = window['pdfjs-dist/build/pdf'];

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    let currentFileArrayBuffer = null;

    function logToSidebar(type, message, isHtml = false) {
        let listId;
        let colorClass;

        switch (type) {
            case 'error':
            case 'status':
                listId = 'logErrors';
                colorClass = type === 'error' ? 'log-error' : 'log-info';
                break;
            case 'literal':
                listId = 'logLiteral';
                colorClass = 'log-info';
                break;
            case 'hex':
                listId = 'logHex';
                colorClass = 'log-hex';
                break;
            default:
                return;
        }

        const ul = document.getElementById(listId);
        if (ul) {
            const li = document.createElement('li');
            li.className = colorClass;
            if (isHtml) {
                li.innerHTML = message;
            } else {
                li.textContent = message;
            }
            ul.appendChild(li);
        }
    }

    // Clear sidebar logs
    function clearSidebar() {
        ['logErrors', 'logLiteral', 'logHex'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });
    }

    let currentRenderTask = null; // Track current render task to cancel if needed

    fileInput.addEventListener('change', (e) => {
        clearSidebar(); // Clear previous logs
        const file = e.target.files[0];
        if (!file) return;

        if (file.type !== 'application/pdf') {
            updateStatus('Erreur : Veuillez sélectionner un fichier PDF valide.', 'red');
            logToSidebar('error', 'Fichier invalide sélectionné.');
            return;
        }

        const fileReader = new FileReader();
        fileReader.onload = function () {
            currentFileArrayBuffer = this.result.slice(0); // Clone the buffer

            // Pass a CLONE to loadAndDisplayPdf to avoid detaching currentFileArrayBuffer
            loadAndDisplayPdf(currentFileArrayBuffer.slice(0))
                .then(() => {
                    updateStatus('PDF chargé avec succès. Aperçu généré.', 'green');
                    logToSidebar('status', 'PDF chargé: ' + file.name);
                })
                .catch(error => {
                    console.error('Error rendering PDF:', error);
                    updateStatus('Erreur lors du chargement du PDF.', 'red');
                    logToSidebar('error', 'Erreur chargement PDF: ' + error.message);
                });
        };

        try {
            fileReader.readAsArrayBuffer(file);
        } catch (error) {
            console.error('Error reading file:', error);
            updateStatus('Erreur lors de la lecture du fichier.', 'red');
        }
    });

    /**
     * Loads a PDF from an ArrayBuffer or Uint8Array and renders the first page.
     * Handles cancelling previous render tasks.
     */
    async function loadAndDisplayPdf(data) {
        // Cancel previous render if it exists
        if (currentRenderTask) {
            currentRenderTask.cancel();
            currentRenderTask = null;
        }

        try {
            // pdfjsLib.getDocument accepts Uint8Array or ArrayBuffer
            const loadingTask = pdfjsLib.getDocument(new Uint8Array(data));
            const pdf = await loadingTask.promise;

            const page = await pdf.getPage(1);
            const scale = 1.0;
            const viewport = page.getViewport({ scale: scale });

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: ctx,
                viewport: viewport
            };

            currentRenderTask = page.render(renderContext);
            await currentRenderTask.promise;

        } catch (err) {
            if (err.name === 'RenderingCancelledException') {
                // Ignore cancelled errors
                return;
            }
            throw err;
        }
    }

    removeBtn.addEventListener('click', () => {
        if (!currentFileArrayBuffer) {
            updateStatus('Veuillez d\'abord sélectionner un fichier PDF.', 'red');
            return;
        }

        const textToRemove = watermarkInput.value;
        if (!textToRemove) {
            updateStatus('Veuillez entrer le texte du filigrane à supprimer.', 'red');
            return;
        }

        updateStatus('Traitement en cours... Veuillez patienter.', 'blue');
        logToSidebar('status', 'Début du traitement (Mode: Download)...');

        const { PDFDocument } = PDFLib;

        PDFDocument.load(currentFileArrayBuffer.slice(0))
            .then(pdfDoc => removeWatermark(pdfDoc, textToRemove))
            .then(pdfDoc => pdfDoc.save())
            .then(pdfBytes => {
                downloadPdf(pdfBytes, 'filigrane_removed.pdf');
                updateStatus('Succès ! Filigrane supprimé. Téléchargement lancé.', 'green');
                logToSidebar('status', 'Succès: Filigrane supprimé.');
            })
            .catch(e => {
                if (e.message === 'No watermark found') {
                    updateStatus('Le texte spécifié n\'a pas été trouvé.', 'orange');
                    logToSidebar('status', 'Aucun texte trouvé à supprimer.');
                } else {
                    console.error(e);
                    updateStatus('Erreur lors de la suppression du filigrane : ' + e.message, 'red');
                    logToSidebar('error', 'Erreur: ' + e.message);
                }
            });
    });

    analyzeBtn.addEventListener('click', () => {
        if (!currentFileArrayBuffer) {
            updateStatus('Veuillez d\'abord sélectionner un fichier PDF.', 'red');
            return;
        }

        const textToRemove = watermarkInput.value;
        if (!textToRemove) {
            updateStatus('Veuillez entrer le texte du filigrane à chercher/analyser.', 'red');
            return;
        }

        updateStatus('Analyse et prévisualisation en cours...', 'blue');
        logToSidebar('status', 'Début du traitement (Mode: Preview)...');

        const { PDFDocument } = PDFLib;

        PDFDocument.load(currentFileArrayBuffer.slice(0))
            .then(pdfDoc => removeWatermark(pdfDoc, textToRemove))
            .then(pdfDoc => pdfDoc.save())
            .then(pdfBytes => {
                updateStatus('Analyse terminée. Filigrane supprimé dans la prévisualisation.', 'green');
                logToSidebar('status', 'Succès: Aperçu mis à jour.');
                return loadAndDisplayPdf(pdfBytes);
            })
            .catch(e => {
                if (e.message === 'No watermark found') {
                    updateStatus('Le texte spécifié n\'a pas été trouvé.', 'orange');
                    logToSidebar('status', 'Aucun texte trouvé à supprimer.');
                } else {
                    console.error(e);
                    updateStatus('Erreur lors de l\'analyse : ' + e.message, 'red');
                    logToSidebar('error', 'Erreur: ' + e.message);
                }
            });
    });

    resetBtn.addEventListener('click', () => {
        if (!currentFileArrayBuffer) {
            updateStatus('Aucun fichier chargé.', 'red');
            return;
        }

        loadAndDisplayPdf(currentFileArrayBuffer.slice(0))
            .then(() => {
                updateStatus('Vue réinitialisée sur le fichier original.', 'green');
                logToSidebar('status', 'Prévisualisation réinitialisée (Original).');
            })
            .catch(e => {
                console.error('Error resetting preview:', e);
                logToSidebar('error', 'Erreur reset: ' + e.message);
            });
    });

    function updateStatus(text, color) {
        statusDiv.textContent = text;
        statusDiv.style.color = color;
    }

    /**
     * Async function to remove watermark from a loaded PDFDocument.
     * Returns a Promise that resolves with the modified PDFDoc, or rejects if not found.
     * @param {PDFDocument} pdfDoc - The loaded pdf-lib document.
     * @param {string} textToRemove - The text pattern to remove.
     * @returns {Promise<PDFDocument>}
     */
    async function removeWatermark(pdfDoc, textToRemove) {
        const { PDFRawStream, PDFName } = PDFLib;

        const escapedText = textToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`\\(${escapedText}\\)`, 'g');
        const hexText = encodeHex(textToRemove);
        const hexPattern = new RegExp(`<${hexText}>`, 'gi');

        const objects = pdfDoc.context.enumerateIndirectObjects();
        let modifiedCount = 0;

        for (const [ref, obj] of objects) {
            // We are looking for streams (where content is stored)
            if (obj instanceof PDFRawStream) {
                let contentBytes = obj.contents;
                let isCompressed = false;

                // Check for compression (Filter: /FlateDecode)
                const filter = obj.dict.get(PDFName.of('Filter'));
                if (filter === PDFName.of('FlateDecode')) {
                    try {
                        contentBytes = pako.inflate(contentBytes);
                        isCompressed = true;
                    } catch (e) {
                        console.warn(`Failed to decompress stream ${ref}`, e);
                        logToSidebar('error', `Erreur décompression stream ${ref}: ${e.message}`);
                        continue;
                    }
                }

                let contentString = "";
                for (let i = 0; i < contentBytes.length; i++) {
                    contentString += String.fromCharCode(contentBytes[i]);
                }

                let streamModified = false;

                // 1. Literal Pattern
                if (contentString.match(pattern)) {
                    logToSidebar('status', `Trouvé (Literal) dans stream ${ref}`);
                    logToSidebar('literal', `${ref}: replace ${pattern} with ()`);
                    contentString = contentString.replace(pattern, '()');
                    streamModified = true;
                    modifiedCount++;
                }

                // 2. Hex Pattern
                if (contentString.match(hexPattern)) {
                    logToSidebar('status', `Trouvé (Hex) dans stream ${ref}`);
                    logToSidebar('hex', `${ref}: replace ${hexPattern} with <>`);
                    contentString = contentString.replace(hexPattern, '<>');
                    streamModified = true;
                    modifiedCount++;
                }

                if (streamModified) {
                    const newBytes = new Uint8Array(contentString.length);
                    for (let i = 0; i < contentString.length; i++) {
                        newBytes[i] = contentString.charCodeAt(i);
                    }

                    if (isCompressed) {
                        try {
                            const compressed = pako.deflate(newBytes);
                            obj.contents = compressed;
                        } catch (e) {
                            console.error('Error recompressing', e);
                        }
                    } else {
                        obj.contents = newBytes;
                    }
                }
            }
        }

        if (modifiedCount > 0) {
            return pdfDoc;
        } else {
            throw new Error('No watermark found');
        }
    }

    function downloadPdf(data, filename) {
        const blob = new Blob([data], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }



    function decodeHex(hex) {
        try {
            let str = '';
            for (let k = 0; k < hex.length; k += 2) {
                str += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
            }
            return str;
        } catch (e) { return '(invalid hex)'; }
    }

    function encodeHex(str) {
        let hex = '';
        for (let i = 0; i < str.length; i++) {
            hex += str.charCodeAt(i).toString(16).toUpperCase();
        }
        return hex;
    }
});
