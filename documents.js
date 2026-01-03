
// =================================================================================
// ARQUIVO: documents.js
// Lógica para a aba de Arquivo Digital / Documentos Emitidos
// =================================================================================

import { state, dom } from './state.js';
import { loadDocuments } from './firestore.js';
import { formatDate, openModal } from './utils.js';

/**
 * Inicializa os listeners da aba de documentos.
 */
export const initDocumentListeners = () => {
    // Listener para o campo de busca
    if (dom.searchDocuments) {
        dom.searchDocuments.addEventListener('input', (e) => {
            renderDocuments(e.target.value);
        });
    }
};

/**
 * Carrega e renderiza a lista de documentos (snapshots).
 * @param {string} filterText - Texto para filtrar a lista localmente.
 */
export const renderDocuments = async (filterText = '') => {
    dom.loadingDocuments.classList.remove('hidden');
    dom.documentsListDiv.innerHTML = '';
    dom.emptyStateDocuments.classList.add('hidden');

    try {
        // Carrega do Firestore se a lista estiver vazia (primeira vez)
        // CORREÇÃO: Mostra o loading ANTES de qualquer operação assíncrona.
        dom.loadingDocuments.classList.remove('hidden');

        // Carrega do Firestore apenas se a lista em memória estiver vazia.
        // Isso evita recargas desnecessárias ao apenas digitar no campo de busca.
        if (state.documents.length === 0) {
            // CORREÇÃO: Espera (await) o carregamento antes de continuar
            state.documents = await loadDocuments();
        }
        dom.loadingDocuments.classList.add('hidden');

        dom.loadingDocuments.classList.add('hidden'); // Esconde o loading APÓS a busca.

        const search = filterText.toLowerCase();
        const filtered = state.documents.filter(doc => {
            return (doc.title && doc.title.toLowerCase().includes(search)) ||
                (doc.studentName && doc.studentName.toLowerCase().includes(search)) ||
                (doc.type && doc.type.toLowerCase().includes(search));
        });

        if (filtered.length === 0) {
            dom.emptyStateDocuments.classList.remove('hidden');
            return;
        }

        const html = filtered.map(doc => {
            const date = doc.createdAt?.toDate ? doc.createdAt.toDate() : new Date(doc.createdAt);
            const dateStr = formatDate(date);

            // Ícone baseado no tipo
            let iconClass = 'fa-file-alt';
            let colorClass = 'text-gray-600 bg-gray-100';

            if (doc.type === 'oficio') { iconClass = 'fa-landmark'; colorClass = 'text-blue-700 bg-blue-100'; }
            else if (doc.type === 'ata') { iconClass = 'fa-file-signature'; colorClass = 'text-purple-700 bg-purple-100'; }
            else if (doc.type === 'notificacao') { iconClass = 'fa-envelope-open-text'; colorClass = 'text-orange-700 bg-orange-100'; }

            return `
            <div class="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:shadow-md transition">
                <div class="flex items-start gap-3">
                    <div class="p-3 rounded-full ${colorClass} shrink-0">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    <div>
                        <h4 class="font-bold text-gray-800 text-sm sm:text-base">${doc.title}</h4>
                        <div class="text-xs text-gray-500 mt-1 space-y-1">
                            <p><i class="far fa-calendar-alt mr-1"></i> Emitido em: ${dateStr}</p>
                            <p><i class="far fa-user mr-1"></i> Por: ${doc.createdBy || 'Sistema'}</p>
                        </div>
                        ${doc.studentName ? `<p class="text-sm font-bold text-sky-900 mt-2 bg-sky-50 inline-block px-3 py-1 rounded border border-sky-100 shadow-sm"><i class="fas fa-user-graduate mr-2 text-sky-600"></i> ${doc.studentName.toUpperCase()}</p>` : ''}
                    </div>
                </div>
                <button class="view-snapshot-btn bg-white text-sky-700 hover:bg-sky-50 px-4 py-2 rounded-lg text-sm font-semibold border border-sky-200 shadow-sm transition whitespace-nowrap"
                    data-id="${doc.id}">
                    <i class="fas fa-eye mr-2"></i> Ver Original
                </button>
            </div>
        `}).join('');

        dom.documentsListDiv.innerHTML = html;

        // Adiciona listeners aos botões gerados
        document.querySelectorAll('.view-snapshot-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const docData = state.documents.find(d => d.id === btn.dataset.id);
                if (docData) openSnapshotModal(docData);
            });
        });

    } catch (error) {
        console.error(error);
        dom.loadingDocuments.classList.add('hidden');
        dom.documentsListDiv.innerHTML = '<p class="text-red-500 text-center p-4">Erro ao carregar documentos.</p>';
    }
};

/**
 * Abre o modal para visualizar o snapshot "congelado".
 */
const openSnapshotModal = (docData) => {
    // Reutiliza o modal de visualização de relatório
    const titleEl = document.getElementById('report-view-title');
    const contentEl = document.getElementById('report-view-content');
    const modal = dom.reportViewModalBackdrop;

    titleEl.textContent = `${docData.title} (Cópia Arquivada)`;

    // Injeta o HTML salvo
    contentEl.innerHTML = docData.htmlContent;

    // VERIFICA SE HÁ ASSINATURA DIGITAL (Fase 3: Exibir no Arquivo Digital)
    // Se existir assinaturas nos metadados, renderiza o rodapé de assinatura igual ao da visão do pai
    // IMPORTANT: Check if signature is NOT already baked in (legacy support vs new support)
    if (docData.signatures && !docData.htmlContent.includes('signatures-wrapper-v2')) {
        // Pega a primeira assinatura encontrada (geralmente responsible_xxx)
        const keys = Object.keys(docData.signatures);
        if (keys.length > 0) {
            const sig = docData.signatures[keys[0]];
            const signedDate = sig.timestamp ? new Date(sig.timestamp).toLocaleString() : 'Data N/A';
            let signatureFooter = '';

            // TIPO 1: DIGITAL (COM BIOMETRIA)
            if (!sig.type || sig.type === 'digital_ack') {
                signatureFooter = `
                <div class="mt-8 pt-6 border-t-2 border-gray-100 break-inside-avoid">
                    <div class="bg-green-50/50 p-4 rounded-lg border border-green-100">
                        <h3 class="text-xs font-bold text-green-700 uppercase tracking-wider mb-4 border-b border-green-200 pb-2 flex items-center gap-2">
                            <i class="fas fa-certificate"></i> Assinatura Digital Verificada
                        </h3>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                            <div>
                                <p class="text-gray-500 text-xs">Assinado por</p>
                                <p class="font-bold text-gray-800">${sig.signerName || 'Não informado'}</p>
                            </div>
                            <div>
                                <p class="text-gray-500 text-xs">CPF</p>
                                <p class="font-bold text-gray-800 font-mono">${sig.signerCPF || '***'}</p>
                            </div>
                            <div>
                                <p class="text-gray-500 text-xs">Data do Registro</p>
                                <p class="font-bold text-gray-800">${signedDate}</p>
                            </div>
                            <div>
                                <p class="text-gray-500 text-xs">IP / Dispositivo</p>
                                <p class="font-bold text-gray-800 font-mono text-xs truncate" title="${sig.ip}">${sig.ip || 'N/A'}</p>
                            </div>
                        </div>
                        ${sig.photo ? `
                        <div class="mt-4 pt-4 border-t border-green-100">
                            <p class="text-xs text-green-700 font-bold mb-2">Registro Biométrico Facial (Selfie)</p>
                            <img src="${sig.photo}" class="w-24 h-24 object-cover rounded-lg border border-green-200 shadow-sm">
                        </div>` : ''}
                    </div>
                </div>`;
            }
            // TIPO 2: UPLOAD (PAPEL)
            else if (sig.type === 'upload') {
                signatureFooter = `
                <div class="mt-8 pt-6 border-t-2 border-gray-100 break-inside-avoid">
                    <div class="bg-white p-6 rounded-lg border border-dashed border-gray-400">
                         <h3 class="text-sm font-bold text-gray-700 uppercase tracking-wider mb-6 border-b border-gray-300 pb-3 flex items-center gap-3">
                            <i class="fas fa-file-signature text-lg"></i> Assinatura Digitalizada
                         </h3>
                         <div class="flex flex-col items-center gap-4">
                            <img src="${sig.image}" class="max-w-md w-full h-auto object-contain border-2 border-gray-100 p-2 rounded shadow-sm bg-gray-50 mix-blend-multiply" />
                            <p class="text-xs text-gray-500 font-mono font-bold bg-gray-100 px-3 py-1 rounded">Registro: ${signedDate}</p>
                         </div>
                    </div>
                </div>`;
            }

            // CHECK FOR FULL SCANNED DOCUMENT (Prioridade Alta)
            if (docData.signatures['_scanned_doc']) {
                const scanned = docData.signatures['_scanned_doc'];
                // Botão PROMINENTE para abrir o digitalizado
                const scannedBanner = `
                <div class="mt-2 mb-6 bg-sky-50 border-l-4 border-sky-500 p-4 shadow-sm break-inside-avoid flex flex-col sm:flex-row items-center justify-between gap-4">
                     <div>
                         <h3 class="text-base font-bold text-sky-900 flex items-center gap-2"><i class="fas fa-file-contract text-xl"></i> Documento Digitalizado Disponível</h3>
                         <p class="text-sm text-sky-700 mt-1">Este arquivo possui uma cópia digitalizada completa anexada.</p>
                     </div>
                     <button onclick="const el = document.getElementById('scanned-doc-viewer-${docData.id}'); el.classList.toggle('hidden');" 
                        class="bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-6 rounded shadow transition flex items-center gap-2 text-sm uppercase tracking-wide">
                         <i class="fas fa-eye"></i> Abrir Digitalização
                     </button>
                </div>
                <div id="scanned-doc-viewer-${docData.id}" class="hidden mb-6 p-4 bg-gray-800 rounded-lg border border-gray-600 shadow-inner flex justify-center">
                     <img src="${scanned.image}" class="max-w-full h-auto shadow-2xl rounded" />
                </div>`;
                // Inserir LOGO APÓS o banner de arquivado
                contentEl.insertAdjacentHTML('afterbegin', scannedBanner);
            }

            if (signatureFooter) {
                contentEl.insertAdjacentHTML('beforeend', signatureFooter);
            }
        }
    }

    // Adiciona uma faixa de aviso no topo
    const dateStr = docData.createdAt?.toDate ? formatDate(docData.createdAt.toDate()) : formatDate(new Date());

    const banner = `
        <div class="bg-yellow-50 border-b border-yellow-200 text-yellow-800 p-2 mb-6 text-xs font-bold text-center uppercase tracking-wide break-inside-avoid no-print">
            <i class="fas fa-archive mr-2"></i> Documento Arquivado - Cópia fiel emitida em ${dateStr} por ${docData.createdBy}
        </div>`;

    contentEl.insertAdjacentHTML('afterbegin', banner);

    openModal(modal);
}
