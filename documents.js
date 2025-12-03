
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
        // Em um app real, poderíamos forçar recarga ou usar onSnapshot
        if (state.documents.length === 0) {
            const docs = await loadDocuments();
            state.documents = docs;
        }

        dom.loadingDocuments.classList.add('hidden');

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
                        ${doc.studentName ? `<p class="text-xs font-semibold text-gray-600 mt-2 bg-gray-50 inline-block px-2 py-1 rounded"><i class="fas fa-user-graduate mr-1"></i> ${doc.studentName}</p>` : ''}
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

    // Adiciona uma faixa de aviso no topo (apenas visualização, não sai na impressão se usarmos a classe no-print corretamente)
    // Mas queremos que saia na impressão que é uma cópia? Geralmente sim.
    const dateStr = docData.createdAt?.toDate ? formatDate(docData.createdAt.toDate()) : formatDate(new Date());
    
    const banner = `
        <div class="bg-yellow-50 border-b border-yellow-200 text-yellow-800 p-2 mb-6 text-xs font-bold text-center uppercase tracking-wide break-inside-avoid">
            <i class="fas fa-archive mr-2"></i> Documento Arquivado - Cópia fiel emitida em ${dateStr} por ${docData.createdBy}
        </div>`;
    
    contentEl.insertAdjacentHTML('afterbegin', banner);

    openModal(modal);
}
