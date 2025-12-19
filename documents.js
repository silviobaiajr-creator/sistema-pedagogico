
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

            // Tenta encontrar dados atualizados do aluno na memória
            const student = state.students.find(s => s.matricula === doc.studentId);
            const studentClass = student ? student.class : (doc.studentClass || ''); // Tenta pegar do doc se existir snapshot

            const hasSignatures = doc.signatures && Object.keys(doc.signatures).length > 0;
            const signatureBadge = hasSignatures
                ? `<span class="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-200 inline-flex items-center gap-1"><i class="fas fa-check-circle"></i> Assinado Digitalmente</span>`
                : `<span class="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-200 inline-flex items-center gap-1"><i class="far fa-clock"></i> Pendente</span>`;

            return `
            <div class="bg-white p-4 rounded-lg border border-gray-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:shadow-md transition">
                <div class="flex items-start gap-3 w-full sm:w-auto">
                    <div class="p-3 rounded-full ${colorClass} shrink-0 relative">
                        <i class="fas ${iconClass}"></i>
                        ${hasSignatures ? '<div class="absolute -bottom-1 -right-1 bg-green-500 text-white text-[8px] p-1 rounded-full w-4 h-4 flex items-center justify-center border-2 border-white"><i class="fas fa-lock"></i></div>' : ''}
                    </div>
                    <div class="w-full">
                        <div class="flex flex-wrap items-center gap-2 mb-1">
                            <h4 class="font-bold text-gray-800 text-sm sm:text-base break-words">${doc.title}</h4>
                            ${signatureBadge}
                        </div>
                        <div class="text-xs text-gray-500 mt-1 space-y-1">
                            <p><i class="far fa-calendar-alt mr-1"></i> Emitido em: ${dateStr}</p>
                            <p><i class="far fa-user mr-1"></i> Por: ${doc.createdBy || 'Sistema'}</p>
                        </div>
                        ${doc.studentName ? `
                        <div class="flex flex-wrap gap-2 mt-2">
                             <p class="text-xs font-bold text-sky-900 bg-sky-50 inline-flex items-center px-2 py-1 rounded border border-sky-100 shadow-sm">
                                <i class="fas fa-user-graduate mr-1 text-sky-600"></i> ${doc.studentName.toUpperCase()}
                             </p>
                             ${studentClass ? `<p class="text-xs font-bold text-gray-600 bg-gray-100 inline-flex items-center px-2 py-1 rounded border border-gray-200">
                                <i class="fas fa-users mr-1 text-gray-400"></i> ${studentClass}
                             </p>` : ''}
                        </div>` : ''}
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

            const signatureFooter = `
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

            contentEl.insertAdjacentHTML('beforeend', signatureFooter);
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
