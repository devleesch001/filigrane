document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('pdfFile');
    const canvas = document.getElementById('pdfPreview');
    const ctx = canvas.getContext('2d');
    const removeBtn = document.getElementById('removeWatermarkBtn');
    const statusDiv = document.getElementById('status');
    const watermarkInput = document.getElementById('watermarkText');
    const pdfjsLib = window['pdfjs-dist/build/pdf'];

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    let currentFileArrayBuffer = null;

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.type !== 'application/pdf') {
            updateStatus('Erreur : Veuillez sélectionner un fichier PDF valide.', 'red');
            return;
        }

        try {
            const fileReader = new FileReader();
            fileReader.onload = async function () {
                currentFileArrayBuffer = this.result.slice(0); // Clone the buffer
                const typedarray = new Uint8Array(this.result);

                const loadingTask = pdfjsLib.getDocument(typedarray);
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
                await page.render(renderContext).promise;

                updateStatus('PDF chargé avec succès. Aperçu généré.', 'green');
            };
            fileReader.readAsArrayBuffer(file);

        } catch (error) {
            console.error('Error rendering PDF:', error);
            updateStatus('Erreur lors du chargement du PDF.', 'red');
        }
    });

    removeBtn.addEventListener('click', async () => {
        if (!currentFileArrayBuffer) {
            updateStatus('Veuillez d\'abord sélectionner un fichier PDF.', 'red');
            return;
        }

        const textToRemove = watermarkInput.value;
        if (!textToRemove) {
            updateStatus('Veuillez entrer le texte du filigrane à supprimer.', 'red');
            return;
        }

        try {
            updateStatus('Traitement en cours... Veuillez patienter.', 'blue');
            await removeWatermark(currentFileArrayBuffer, textToRemove);
        } catch (e) {
            console.error(e);
            updateStatus('Erreur lors de la suppression du filigrane : ' + e.message, 'red');
        }
    });

    function updateStatus(text, color) {
        statusDiv.textContent = text;
        statusDiv.style.color = color;
    }

    async function removeWatermark(arrayBuffer, textToRemove) {
        const { PDFDocument, PDFRawStream, PDFName } = PDFLib;
        const pdfDoc = await PDFDocument.load(arrayBuffer);

        // This regex attempts to find the text in PDF string format.
        // It's basic and handles simple cases e.g., (MyWatermark)
        // We escape special regex characters in the user input.
        const escapedText = textToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`\\(${escapedText}\\)`, 'g');

        // Iterate over all indirect objects in the PDF
        const objects = pdfDoc.context.enumerateIndirectObjects();
        let modifiedCount = 0;

        for (const [ref, obj] of objects) {
            console.log(ref, obj);

            // We are looking for streams (where content is stored)
            if (obj instanceof PDFRawStream) {
                let contentBytes = obj.contents;
                let isCompressed = false;

                // Check for compression (Filter: /FlateDecode)
                const filter = obj.dict.get(PDFName.of('Filter'));
                if (filter === PDFName.of('FlateDecode')) {
                    try {
                        // Decompress using pako
                        contentBytes = pako.inflate(contentBytes);
                        isCompressed = true;
                    } catch (e) {
                        console.warn('Failed to decompress stream', ref, e);
                        continue; // Skip if we can't decompress
                    }
                }

                // Convert bytes to string (PDF contents are usually ASCII-ish / binary mixed, 
                // Note: This conversion might corrupt binary image data if we treat it as pure utf-8.
                // However, 'String.fromCharCode' preserves byte values 0-255 in the lower byte of chars.
                // A safer way is to use TextDecoder only if we claim it's text,
                // but for massive seek/replace in mixed data, we need to be careful.
                // We'll proceed by converting to a "binary string".
                // Convert bytes to string (PDF contents are usually ASCII-ish / binary mixed)
                let contentString = "";
                for (let i = 0; i < contentBytes.length; i++) {
                    contentString += String.fromCharCode(contentBytes[i]);
                }

                // DEBUG: Log the start of the stream to see what it looks like
                if (contentString.length > 0) {
                    console.log(`Stream ${ref.toString()} (first 500 chars):`, contentString.substring(0, 500));
                }

                let streamModified = false;

                // 1. Literal Pattern
                if (contentString.match(pattern)) {
                    console.log(`Found "${textToRemove}" in plain text in stream ${ref.toString()}`);
                    contentString = contentString.replace(pattern, '()');
                    streamModified = true;
                    modifiedCount++;
                    console.log(`Removed plain text occurrence in ${ref.toString()}`);
                }

                // 2. Hex Pattern
                // e.g. (Hello) -> <48656C6C6F>
                const hexText = textToRemove.split('').map(c => c.charCodeAt(0).toString(16).toUpperCase()).join('');
                // PDF hex strings can be uppercase or lowercase, and might have spaces.
                // We'll try strict hex first.
                const hexPattern = new RegExp(`<${hexText}>`, 'gi');

                if (contentString.match(hexPattern)) {
                    console.log(`Found hex representation <${hexText}> in stream ${ref.toString()}`);
                    contentString = contentString.replace(hexPattern, '<>'); // Replace with empty hex string
                    streamModified = true;
                    modifiedCount++;
                    console.log(`Removed hex text occurrence in ${ref.toString()}`);
                }

                if (streamModified) {
                    // Convert back to bytes
                    const newBytes = new Uint8Array(contentString.length);
                    for (let i = 0; i < contentString.length; i++) {
                        newBytes[i] = contentString.charCodeAt(i);
                    }

                    // Apply changes to the object
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
            const pdfBytes = await pdfDoc.save();
            downloadPdf(pdfBytes, 'filigrane_removed.pdf');
            updateStatus(`Succès ! ${modifiedCount} occurrences supprimées. Téléchargement lancé.`, 'green');
        } else {
            updateStatus('Le texte spécifié n\'a pas été trouvé dans le document (ou il est encodé différemment).', 'orange');
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
});
