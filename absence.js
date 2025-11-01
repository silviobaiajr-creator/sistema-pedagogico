// =================================================================================
// ARQUIVO: absence.js (NOVO E CORRIGIDO)
// RESPONSABILIDADE: Gerenciar toda a lógica, UI e eventos da
// funcionalidade "Busca Ativa".
//
// ATUALIZAÇÃO (V4 - LAYOUT UNIFICADO - 01/11/2025):
// 1. (renderAbsences) Reescrita para espelhar o layout do 'occurrence.js'.
// 2. O conteúdo do acordeão agora é dividido em "Histórico Individual" (lista)
//    e "Ações" (bloco de botões).
// 3. Removidos os menus Kebab de cada linha de histórico.
// 4. (initAbsenceListeners) Atualizada para lidar com os novos botões no
//    bloco "Ações" (Avançar, Editar, Limpar, etc.).
// 5. Adicionados botões "Avançar Etapa", "Editar Ação" e "Limpar Ação"
//    para consistência com o fluxo de Ocorrências.
// =================================================================================

import { state, dom } from './state.js';
import { showToast, openModal, closeModal, formatDate, formatTime } from './utils.js'; // Adicionado formatTime
import { getStudentProcessInfo, determineNextActionForStudent } from './logic.js';
import { actionDisplayTitles, openFichaViewModal, generateAndShowConsolidatedFicha, generateAndShowOficio, openAbsenceHistoryModal, generateAndShowBuscaAtivaReport } from './reports.js';
import { updateRecordWithHistory, addRecordWithHistory, deleteRecord, getCollectionRef } from './firestore.js';
import { doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase.js';


// --- Funções Auxiliares (Novas ou Modificadas para Consistência) ---

/**
 * Obtém a data principal de uma ação para fins de comparação cronológica.
 * @param {object} action - O objeto da ação.
 * @returns {string|null} A data no formato YYYY-MM-DD ou null.
 */
const getActionMainDate = (action) => {
    if (!action) return null;
    switch (action.actionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            // Corrigido: Usar contactDate se disponível (data real do contato), senão meetingDate (agendamento)
            return action.contactDate || action.meetingDate;
        case 'visita':
            return action.visitDate;
        case 'encaminhamento_ct':
            return action.ctSentDate;
        case 'analise':
            // Análise não tem data própria relevante para sequência, podemos usar createdAt
             return action.createdAt?.toDate ? action.createdAt.toDate().toISOString().split('T')[0] : null;
        default:
            return null;
    }
};

/**
 * Obtém o elemento de input de data relevante para o tipo de ação no modal.
 * @param {string} actionType - O tipo da ação ('tentativa_1', 'visita', etc.).
 * @returns {HTMLInputElement|null} O elemento input ou null.
 */
const getDateInputForActionType = (actionType) => {
    switch (actionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
             // A data editável é a do contato real, se houver sucesso, senão a da convocação
             return document.getElementById('contact-date') || document.getElementById('meeting-date');
        case 'visita':
            return document.getElementById('visit-date');
        case 'encaminhamento_ct':
            return document.getElementById('ct-sent-date');
        default:
            return null; // Análise não tem input de data principal
    }
};


// --- Funções de UI ---

/**
 * Configura o autocomplete para a barra de busca da Busca Ativa.
 */
const setupAbsenceAutocomplete = () => {
    const input = document.getElementById('search-absences');
    const suggestionsContainer = document.getElementById('absence-student-suggestions');
    
    input.addEventListener('input', () => {
        const value = input.value.toLowerCase();
        state.filterAbsences = value;
        renderAbsences();
        
        suggestionsContainer.innerHTML = '';
        if (!value) {
            suggestionsContainer.classList.add('hidden');
            return;
        }
        
        const filteredStudents = state.students.filter(s => s.name.toLowerCase().startsWith(value)).slice(0, 5);
        
        if (filteredStudents.length > 0) {
            suggestionsContainer.classList.remove('hidden');
            filteredStudents.forEach(student => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = student.name;
                item.addEventListener('click', () => {
                    handleNewAbsenceAction(student); // Chama o handler de nova ação
                    input.value = '';
                    state.filterAbsences = '';
                    renderAbsences();
                    suggestionsContainer.classList.add('hidden');
                });
                suggestionsContainer.appendChild(item);
            });
        } else {
            suggestionsContainer.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!suggestionsContainer.contains(e.target) && e.target !== input) {
            suggestionsContainer.classList.add('hidden');
        }
    });
};


// =================================================================================
// --- INÍCIO DA REESCRITA (renderAbsences) ---
// Função reescrita para usar o layout de acordeão unificado (V4).
// =================================================================================
/**
 * Renderiza a lista de Busca Ativa.
 * (MODIFICADO - V4): Adota o layout de Histórico + Ações do 'occurrence.js'.
 */
export const renderAbsences = () => {
    dom.loadingAbsences.classList.add('hidden');
    const searchFiltered = state.absences.filter(a => {
        const student = state.students.find(s => s.matricula === a.studentId);
        return student && student.name.toLowerCase().startsWith(state.filterAbsences.toLowerCase());
    });

    const groupedByProcess = searchFiltered.reduce((acc, action) => {
        const key = action.processId || `no-proc-${action.id}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(action);
        return acc;
    }, {});

    const filteredGroupKeys = Object.keys(groupedByProcess).filter(processId => {
        const actions = groupedByProcess[processId];
        // Adiciona verificação para evitar erro se actions for undefined ou vazio
        if (!actions || actions.length === 0) return false;
        
        // Ordena as ações pela data principal para robustez na sequência
        actions.sort((a, b) => {
            const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
            const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
            // Converte para timestamp para comparação segura
            // Adiciona T00:00:00 se for string para evitar problemas de fuso na conversão
            const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
            const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
            // Se as datas forem iguais, usa createdAt como desempate
            if (timeA === timeB) {
                const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
                const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
                return (createA || 0) - (createB || 0);
            }
            return (timeA || 0) - (timeB || 0); // Ordena do mais antigo para o mais recente
        });


        // ==============================================================================
        // --- Lógica do Filtro de Data (usando data da PRIMEIRA ação) ---
        // ==============================================================================
        const { startDate, endDate } = state.filtersAbsences;
        const firstAction = actions[0];
        // Tenta usar a data principal da primeira ação, senão a de criação
        const processStartDateRaw = getActionMainDate(firstAction) || firstAction.createdAt;
        let processStartDate;
        if (processStartDateRaw instanceof Date) {
            processStartDate = processStartDateRaw;
        } else if (typeof processStartDateRaw === 'string') {
             try { processStartDate = new Date(processStartDateRaw + 'T00:00:00Z'); } catch { processStartDate = new Date(0); } // Fallback
        } else if (processStartDateRaw?.seconds) {
             processStartDate = new Date(processStartDateRaw.seconds * 1000);
        } else {
             processStartDate = new Date(0); // Fallback se tudo falhar
        }


        // Compara com a data de início (se existir)
        if (startDate) {
            const filterStartDate = new Date(startDate + 'T00:00:00Z'); // Usa Z para UTC
            if (processStartDate < filterStartDate) return false;
        }
        // Compara com a data de fim (se existir)
        if (endDate) {
            const filterEndDate = new Date(endDate + 'T23:59:59Z'); // Usa Z para UTC
            if (processStartDate > filterEndDate) return false;
        }
        // ==============================================================================
        // --- FIM FILTRO DE DATA ---
        // ==============================================================================

        // --- Lógica dos outros filtros (Status, Pendência, Retorno) ---
        const { processStatus, pendingAction, returnStatus } = state.filtersAbsences;
        const isConcluded = actions.some(a => a.actionType === 'analise');
        if (processStatus === 'in_progress' && isConcluded) return false;
        if (processStatus === 'concluded' && !isConcluded) return false;

        const lastAction = actions[actions.length - 1]; // Já está ordenado
        if (pendingAction !== 'all') {
            if (isConcluded) return false; // Processos concluídos não têm ações pendentes

            // Verifica pendência de CONTATO (tentativa OU visita sem sucesso preenchido)
            let isCurrentlyPendingContact =
                (lastAction.actionType.startsWith('tentativa') && lastAction.contactSucceeded == null) ||
                (lastAction.actionType === 'visita' && lastAction.visitSucceeded == null);

            // Verifica pendência de FEEDBACK CT (existe ação CT, não tem feedback E não está concluído)
            let isCurrentlyPendingFeedback = false;
            const ctAction = actions.find(a => a.actionType === 'encaminhamento_ct');
            if (ctAction && !isConcluded) {
                isCurrentlyPendingFeedback = ctAction.ctFeedback == null;
            }

            if (pendingAction === 'pending_contact' && !isCurrentlyPendingContact) return false;
            if (pendingAction === 'pending_feedback' && !isCurrentlyPendingFeedback) return false;
        }

        if (returnStatus !== 'all') {
             // Encontra a ÚLTIMA ação que teve o status de retorno (yes/no) DEFINIDO
             const lastActionWithReturnInfo = [...actions].reverse().find(a =>
                a.contactReturned === 'yes' || a.contactReturned === 'no' ||
                a.visitReturned === 'yes' || a.visitReturned === 'no' ||
                a.ctReturned === 'yes' || a.ctReturned === 'no'
             );

             if (lastActionWithReturnInfo) {
                 // Se encontrou uma ação com status definido (yes/no)
                 const lastDefinitiveStatus = lastActionWithReturnInfo.contactReturned || lastActionWithReturnInfo.visitReturned || lastActionWithReturnInfo.ctReturned;
                 if (returnStatus === 'returned' && lastDefinitiveStatus !== 'yes') return false;
                 if (returnStatus === 'not_returned' && lastDefinitiveStatus !== 'no') return false;
                 if (returnStatus === 'pending') return false; // Se já tem status 'yes'/'no', não está pendente
             } else {
                 // Se NENHUMA ação teve retorno 'yes' ou 'no' ainda, está Pendente
                 if (returnStatus === 'returned' || returnStatus === 'not_returned') return false; // Não pode filtrar por 'yes'/'no' se está pendente
                 // Se o filtro é 'pending', mantém (return true implícito)
             }
        }
        // Se passou por todos os filtros, mantém o processo
        return true;
    });


    // --- Lógica para exibir estado vazio ou a lista ---
    // (Verifica todos os filtros, incluindo datas)
    if (filteredGroupKeys.length === 0 && state.filterAbsences === '' && state.filtersAbsences.processStatus === 'all' && state.filtersAbsences.pendingAction === 'all' && state.filtersAbsences.returnStatus === 'all' && !state.filtersAbsences.startDate && !state.filtersAbsences.endDate) {
        dom.emptyStateAbsences.classList.remove('hidden');
        dom.absencesListDiv.innerHTML = '';
    } else {
        dom.emptyStateAbsences.classList.add('hidden');
        // Ordena os PROCESSOS pela data da ÚLTIMA ação (mais recente primeiro)
        const sortedGroupKeys = filteredGroupKeys.sort((a, b) => {
            const actionsA = groupedByProcess[a];
            const actionsB = groupedByProcess[b];
            const lastActionA = actionsA?.length > 0 ? actionsA[actionsA.length - 1] : null;
            const lastActionB = actionsB?.length > 0 ? actionsB[actionsB.length - 1] : null;

            // Usa a data principal ou createdAt para ordenar os processos
            const timeA = getActionMainDate(lastActionA) || lastActionA?.createdAt;
            const timeB = getActionMainDate(lastActionB) || lastActionB?.createdAt;

            // Converte para timestamp para comparação segura
            const timestampA = timeA instanceof Date ? timeA.getTime() : (typeof timeA === 'string' ? new Date(timeA+'T00:00:00Z').getTime() : (timeA?.seconds || 0) * 1000);
            const timestampB = timeB instanceof Date ? timeB.getTime() : (typeof timeB === 'string' ? new Date(timeB+'T00:00:00Z').getTime() : (timeB?.seconds || 0) * 1000);

            return (timestampB || 0) - (timestampA || 0); // Mais recente primeiro
        });


        let html = '';
        for (const processId of sortedGroupKeys) {
            // As ações DENTRO de um processo já foram ordenadas cronologicamente acima
            const actions = groupedByProcess[processId];
            if (!actions || actions.length === 0) continue;

            const firstAction = actions[0];
            const lastProcessAction = actions[actions.length - 1]; // Pega a última ação do processo
            const student = state.students.find(s => s.matricula === firstAction.studentId);
            if (!student) continue;

            const isConcluded = actions.some(a => a.actionType === 'analise');
            
            // --- (INÍCIO LÓGICA V4) ---
            
            // 1. Gera o Histórico de Ações Concluídas (para dentro do acordeão)
            let historyHtml = '';
            actions.forEach(abs => {
                const actionDisplayDate = getActionMainDate(abs) || (abs.createdAt?.toDate() ? abs.createdAt.toDate().toISOString().split('T')[0] : '');

                const returned = abs.contactReturned === 'yes' || abs.visitReturned === 'yes' || abs.ctReturned === 'yes';
                const notReturned = abs.contactReturned === 'no' || abs.visitReturned === 'no' || abs.ctReturned === 'no';
                
                let statusHtml = '';
                if (abs.actionType.startsWith('tentativa')) {
                    if (abs.contactSucceeded === 'yes') {
                        statusHtml = `<span class="text-xs text-green-600 font-semibold">(<i class="fas fa-check"></i> Contato Realizado)</span>`;
                    } else if (abs.contactSucceeded === 'no') {
                        statusHtml = `<span class="text-xs text-red-600 font-semibold">(<i class="fas fa-times"></i> Contato Não Realizado)</span>`;
                    } else {
                        statusHtml = `<span class="text-xs text-yellow-600 font-semibold">(<i class="fas fa-hourglass-half"></i> Aguardando Contato)</span>`;
                    }
                } else if (abs.actionType === 'visita') {
                     if (abs.visitSucceeded === 'yes') {
                        statusHtml = `<span class="text-xs text-green-600 font-semibold">(<i class="fas fa-check"></i> Contato Realizado)</span>`;
                    } else if (abs.visitSucceeded === 'no') {
                        statusHtml = `<span class="text-xs text-red-600 font-semibold">(<i class="fas fa-times"></i> Contato Não Realizado)</span>`;
                    } else {
                        statusHtml = `<span class="text-xs text-yellow-600 font-semibold">(<i class="fas fa-hourglass-half"></i> Aguardando Contato)</span>`;
                    }
                } else if (abs.actionType === 'encaminhamento_ct') {
                    statusHtml = abs.ctFeedback ? `<span class="text-xs text-green-600 font-semibold">(<i class="fas fa-inbox"></i> Devolutiva Recebida)</span>` : `<span class="text-xs text-yellow-600 font-semibold">(<i class="fas fa-hourglass-half"></i> Aguardando Devolutiva)</span>`;
                }

                historyHtml += `
                    <p class="text-xs text-gray-600">
                        <i class="fas fa-check text-green-500 fa-fw mr-1"></i>
                        <strong>${actionDisplayTitles[abs.actionType] || 'N/A'}</strong> (Data: ${formatDate(actionDisplayDate)}) ${statusHtml}
                        ${returned ? '<span class="text-xs text-green-600 font-semibold ml-1">[<i class="fas fa-check-circle"></i> Retornou]</span>' : ''}
                        ${notReturned ? '<span class="text-xs text-red-600 font-semibold ml-1">[<i class="fas fa-times-circle"></i> Não Retornou]</span>' : ''}
                    </p>
                `;
            });
            
            // 2. Gera os Botões de Ação (para dentro do acordeão)
            const disableEditDelete = isConcluded || !lastProcessAction;
            const disableReason = isConcluded ? "Processo concluído" : "Apenas a última ação pode ser alterada";

            // Botão Avançar Etapa
            const avancarBtn = `
                <button type="button"
                        class="avancar-etapa-btn text-indigo-600 hover:text-indigo-900 text-xs font-semibold py-1 px-2 rounded-md bg-indigo-50 hover:bg-indigo-100 ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}"
                        title="${isConcluded ? 'Processo concluído' : 'Avançar para a próxima etapa'}"
                        ${isConcluded ? 'disabled' : ''}
                        data-student-id="${student.matricula}">
                    <i class="fas fa-plus"></i> Avançar Etapa
                </button>
            `;
            
            // Botão Editar Ação
            const editBtn = `
                <button type="button"
                        class="edit-absence-action-btn text-yellow-600 hover:text-yellow-900 text-xs font-semibold py-1 px-2 rounded-md bg-yellow-50 hover:bg-yellow-100 ${disableEditDelete ? 'opacity-50 cursor-not-allowed' : ''}"
                        title="${disableReason}"
                        ${disableEditDelete ? 'disabled' : ''}
                        data-id="${lastProcessAction.id}">
                    <i class="fas fa-pencil-alt"></i> Editar Ação
                </button>
            `;

            // Botão Limpar Ação
            const limparBtn = `
                <button type="button"
                        class="reset-absence-action-btn text-red-600 hover:text-red-900 text-xs font-semibold py-1 px-2 rounded-md bg-red-50 hover:bg-red-100 ${disableEditDelete ? 'opacity-50 cursor-not-allowed' : ''}"
                        title="${disableReason}"
                        ${disableEditDelete ? 'disabled' : ''}
                        data-id="${lastProcessAction.id}">
                    <i class="fas fa-undo-alt"></i> Limpar Ação
                </button>
            `;

            // Botão Notificação
            const lastNotificationAction = [...actions].reverse().find(a => a.meetingDate && a.meetingTime);
            const notificationBtn = lastNotificationAction ? `
                <button type="button"
                        class="notification-btn text-indigo-600 hover:text-indigo-900 text-xs font-semibold py-1 px-2 rounded-md bg-indigo-50 hover:bg-indigo-100"
                        data-id="${lastNotificationAction.id}"
                        title="Gerar Notificação (baseada na última convocação)">
                    <i class="fas fa-paper-plane"></i> Notificação
                </button>
            ` : '';
            
            // Botão Enviar ao CT
            const visitAction = actions.find(a => a.actionType === 'visita');
            const hasCtAction = actions.some(a => a.actionType === 'encaminhamento_ct');
            const disabledSendCt = isConcluded || hasCtAction || !visitAction;
            const sendCtTitle = isConcluded ? 'Processo concluído' : (hasCtAction ? 'Encaminhamento já realizado' : (!visitAction ? 'Requer Ação de Visita' : 'Enviar ao Conselho Tutelar'));
            
            const sendCtBtn = `
                <button type="button"
                        class="send-ct-btn text-blue-600 hover:text-blue-900 text-xs font-semibold py-1 px-2 rounded-md bg-blue-50 hover:bg-blue-100 ${disabledSendCt ? 'opacity-50 cursor-not-allowed' : ''}"
                        ${disabledSendCt ? 'disabled' : ''}
                        title="${sendCtTitle}"
                        data-id="${visitAction?.id || ''}">
                    <i class="fas fa-gavel"></i> Enviar ao CT
                </button>
            `;
            
            // Botão Ver Ofício
            const ctAction = actions.find(a => a.actionType === 'encaminhamento_ct' && a.oficioNumber);
            const viewOficioBtn = ctAction ? `
                <button type="button"
                        class="view-oficio-btn text-green-600 hover:text-green-900 text-xs font-semibold py-1 px-2 rounded-md bg-green-50 hover:bg-green-100"
                        data-id="${ctAction.id}"
                        title="Visualizar Ofício Nº ${ctAction.oficioNumber}">
                    <i class="fas fa-file-alt"></i> Ver Ofício
                </button>
            ` : '';

            // --- FIM LÓGICA V4 ---


            // --- Renderização do Cabeçalho do Processo (Card) ---
            const contentId = `ba-content-${processId}`;
            html += `
                <div class="border rounded-lg mb-4 bg-white shadow">
                    <!-- Cabeçalho Clicável (DIV) -->
                    <div class="process-header bg-gray-50 hover:bg-gray-100 cursor-pointer p-4 flex justify-between items-center"
                         data-content-id="${contentId}">
                        <div>
                            <!-- (Corrigido) Botão "Avançar" removido do nome, agora está dentro do acordeão -->
                            <p class="font-semibold text-gray-800">${student.name}</p>
                            <p class="text-sm text-gray-500">ID do Processo: ${processId} - Início: ${formatDate(firstAction.createdAt?.toDate())}</p>
                        </div>
                        <div class="flex items-center space-x-4">
                            ${isConcluded ? '<span class="text-xs font-bold text-white bg-green-600 px-2 py-1 rounded-full">CONCLUÍDO</span>' : '<span class="text-xs font-bold text-white bg-yellow-600 px-2 py-1 rounded-full">EM ANDAMENTO</span>'}
                            <button class="generate-ficha-btn-row bg-purple-600 text-white font-bold py-1 px-3 rounded-lg shadow-md hover:bg-purple-700 text-xs no-print" data-student-id="${student.matricula}" data-process-id="${processId}">
                                <i class="fas fa-file-invoice"></i> Ficha
                            </button>
                            <i class="fas fa-chevron-down transition-transform duration-300"></i>
                        </div>
                    </div>
                    
                    <!-- Conteúdo Oculto (process-content) -->
                    <div class="process-content" id="${contentId}" style="max-height: 0px; overflow: hidden;">
                        <div class="p-4 border-t border-gray-200">
                             <h5 class="text-xs font-bold uppercase text-gray-500 mb-2">Histórico Individual</h5>
                             <div class="space-y-1 mb-3">
                                ${historyHtml}
                             </div>
                             <h5 class="text-xs font-bold uppercase text-gray-500 mb-2">Ações</h5>
                             <div class="flex items-center flex-wrap gap-2">
                                ${avancarBtn}
                                ${editBtn}
                                ${limparBtn}
                                ${notificationBtn}
                                ${sendCtBtn}
                                ${viewOficioBtn}
                             </div>
                        </div>
                    </div>
                </div>
            `;
        } // Fim do loop for...of sortedGroupKeys
        dom.absencesListDiv.innerHTML = html; // Atualiza o DOM com todo o HTML gerado
    } // Fim do else (se há processos para mostrar)
};
// =================================================================================
// --- FIM DA REESCRITA (renderAbsences) ---
// =================================================================================


/**
 * Lógica para determinar a próxima ação de busca ativa.
 * (MODIFICADO - CORREÇÃO 2) Adiciona verificação do campo `...Returned`
 */
export const handleNewAbsenceAction = (student) => {
    const { currentCycleActions } = getStudentProcessInfo(student.matricula);
    // Ordena as ações do ciclo atual para garantir que a última seja realmente a última
    currentCycleActions.sort((a, b) => {
        const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
        const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
        const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
        const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
         if (timeA === timeB) {
            const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
            const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
            return (createA || 0) - (createB || 0);
        }
        return (timeA || 0) - (timeB || 0);
    });

    if (currentCycleActions.length > 0) {
        const lastAction = currentCycleActions[currentCycleActions.length - 1];
        let isPending = false;
        let pendingActionMessage = "Complete a etapa anterior para poder prosseguir.";

        // --- INÍCIO DA CORREÇÃO 2 ---
        // Verifica pendências na ÚLTIMA ação registrada
        if (lastAction.actionType.startsWith('tentativa')) {
            if (lastAction.contactSucceeded == null) { // Primeiro, verifica se o contato foi registrado
                isPending = true;
                pendingActionMessage = "Registre se houve sucesso no contato da última tentativa.";
            } else if (lastAction.contactReturned == null) { // DEPOIS, verifica se "retornou" foi registrado
                isPending = true;
                pendingActionMessage = "Registre se o aluno retornou após o contato.";
            }
        } else if (lastAction.actionType === 'visita') {
            if (lastAction.visitSucceeded == null) { // Primeiro, verifica se a visita foi registrada
                isPending = true;
                pendingActionMessage = "Registre se houve sucesso no contato da visita.";
            } else if (lastAction.visitReturned == null) { // DEPOIS, verifica se "retornou" foi registrado
                isPending = true;
                pendingActionMessage = "Registre se o aluno retornou após a visita.";
            }
        } else if (lastAction.actionType === 'encaminhamento_ct') {
            if (lastAction.ctFeedback == null) { // Primeiro, verifica se o feedback foi registrado
                isPending = true;
                pendingActionMessage = "Registre a devolutiva recebida do Conselho Tutelar.";
            } else if (lastAction.ctReturned == null) { // DEPOIS, verifica se "retornou" foi registrado
                isPending = true;
                pendingActionMessage = "Registre se o aluno retornou após a ação do CT.";
            }
        }
        // --- FIM DA CORREÇÃO 2 ---

        // Se a ÚLTIMA ação está pendente, abre para EDITÁ-LA
        if (isPending) {
            showToast(pendingActionMessage);
            openAbsenceModalForStudent(student, lastAction.actionType, lastAction); // Abre para editar a última
            return;
        }
    }
    // Se não há pendências na última ação, determina a PRÓXIMA e abre para CRIAR
    const nextActionType = determineNextActionForStudent(student.matricula);
    if (nextActionType) {
        openAbsenceModalForStudent(student, nextActionType); // Abre para criar a próxima
    } else {
        showToast("Processo já concluído ou em etapa final."); // Caso não haja próxima ação (ex: 'analise' já feita)
    }
};


/**
 * Ativa/Desativa campos de detalhe de contato (Família).
 */
export const toggleFamilyContactFields = (enable, fieldsContainer) => {
    if (!fieldsContainer) return;
    fieldsContainer.classList.toggle('hidden', !enable);
    const detailFields = fieldsContainer.querySelectorAll('input[type="date"], input[type="text"], textarea, select');
    detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable; // Torna obrigatório apenas se habilitado
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            // Limpa o valor se desabilitado para evitar salvar dados inconsistentes
            // if (input.type !== 'radio' && input.type !== 'checkbox') input.value = '';
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

/**
 * Ativa/Desativa campos de detalhe de contato (Visita).
 */
export const toggleVisitContactFields = (enable, fieldsContainer) => {
     if (!fieldsContainer) return;
     fieldsContainer.classList.toggle('hidden', !enable);
     const detailFields = fieldsContainer.querySelectorAll('input[type="text"], textarea');
     detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable; // Torna obrigatório apenas se habilitado
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            // Limpa o valor se desabilitado
            // input.value = '';
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

/**
 * Abre e popula o modal de registro/edição de uma ação de Busca Ativa.
 * (MODIFICADO - CONSISTÊNCIA 2): Define a data mínima (`min`) para o input de data.
 * (MODIFICADO - CORREÇÃO 1) Adiciona `required` aos rádios `...Returned`.
 */
export const openAbsenceModalForStudent = (student, forceActionType = null, data = null) => {
    dom.absenceForm.reset();
    // Limpa atributos 'min' dos campos de data para evitar conflitos entre aberturas
    ['meeting-date', 'contact-date', 'visit-date', 'ct-sent-date'].forEach(id => { // Inclui contact-date
        const input = document.getElementById(id);
        if (input) input.removeAttribute('min');
    });
    // Garante que todos os campos comecem sem 'required'
    dom.absenceForm.querySelectorAll('[required]').forEach(el => el.required = false);


    const isEditing = !!data;
    document.getElementById('absence-modal-title').innerText = isEditing ? 'Editar Ação de Busca Ativa' : 'Registar Ação de Busca Ativa';
    document.getElementById('absence-id').value = isEditing ? data.id : '';

    // Preenche dados do aluno (readonly)
    document.getElementById('absence-student-name').value = student.name || '';
    document.getElementById('absence-student-class').value = student.class || '';
    document.getElementById('absence-student-endereco').value = student.endereco || '';
    document.getElementById('absence-student-contato').value = student.contato || '';
    
    // --- Obtém informações do processo e ordena as ações ---
    const { processId, currentCycleActions } = getStudentProcessInfo(student.matricula);
    currentCycleActions.sort((a, b) => { // Ordena para encontrar a ação anterior corretamente
        const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
        const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
        const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
        const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
        if (timeA === timeB) {
           const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
           const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
           return (createA || 0) - (createB || 0);
        }
        return (timeA || 0) - (timeB || 0);
    });

    document.getElementById('absence-process-id').value = data?.processId || processId;

    // Determina o tipo de ação final
    const finalActionType = forceActionType || (isEditing ? data.actionType : determineNextActionForStudent(student.matricula));
    document.getElementById('action-type').value = finalActionType;
    document.getElementById('action-type-display').value = actionDisplayTitles[finalActionType] || '';
    // Mostra/esconde os grupos de campos corretos
    handleActionTypeChange(finalActionType); // Chama a função que mostra/esconde

    // --- Lógica de dados de faltas (ReadOnly ou Editável) ---
    const absenceDataContainer = dom.absenceForm.querySelector('#absence-form > .bg-gray-50'); // Container dos dados de falta
    const absenceInputs = absenceDataContainer.querySelectorAll('input');
    const firstAbsenceRecordInCycle = currentCycleActions.find(a => a.periodoFaltasStart);
    // Dados de falta são editáveis APENAS ao criar/editar a PRIMEIRA tentativa (tentativa_1) do ciclo
    const isAbsenceDataEditable = finalActionType === 'tentativa_1'; // Simplificado: só editável na T1

    // Define 'required' para dados de falta APENAS se editável
    document.getElementById('absence-start-date').required = isAbsenceDataEditable;
    document.getElementById('absence-end-date').required = isAbsenceDataEditable;
    document.getElementById('absence-count').required = isAbsenceDataEditable;

    // Preenche e bloqueia/desbloqueia campos de falta
    if (firstAbsenceRecordInCycle && !isAbsenceDataEditable) {
        // Se já existe registro com dados de falta E não estamos editando T1, preenche e bloqueia
        document.getElementById('absence-start-date').value = firstAbsenceRecordInCycle.periodoFaltasStart || '';
        document.getElementById('absence-end-date').value = firstAbsenceRecordInCycle.periodoFaltasEnd || '';
        document.getElementById('absence-count').value = firstAbsenceRecordInCycle.absenceCount || '';
        absenceInputs.forEach(input => { input.readOnly = true; input.classList.add('bg-gray-100'); });
    } else if (isEditing && data.actionType === 'tentativa_1') {
         // Se está editando T1, preenche com os dados de T1 (que podem ser diferentes do firstRecord se houve edições anteriores)
         document.getElementById('absence-start-date').value = data.periodoFaltasStart || '';
         document.getElementById('absence-end-date').value = data.periodoFaltasEnd || '';
         document.getElementById('absence-count').value = data.absenceCount || '';
         absenceInputs.forEach(input => { input.readOnly = false; input.classList.remove('bg-gray-100'); });
    } else if (!isEditing && finalActionType === 'tentativa_1') {
        // Se está criando T1, campos ficam vazios e editáveis
        absenceInputs.forEach(input => { input.readOnly = false; input.classList.remove('bg-gray-100'); });
    } else {
        // Outros casos (criando T2, T3, etc.), campos ficam vazios e bloqueados
        absenceInputs.forEach(input => { input.readOnly = true; input.classList.add('bg-gray-100'); });
    }


    // --- Define campos obrigatórios específicos da AÇÃO ATUAL ---
    switch (finalActionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            document.getElementById('meeting-date').required = true;
            document.getElementById('meeting-time').required = true;
            // 'contactSucceeded' radio é obrigatório (já validado no submit)
            // Campos dentro de 'family-contact-fields' tornam-se required via toggleFamilyContactFields
            
            // --- INÍCIO DA CORREÇÃO 1 ---
            // 'contactReturned' radio NÃO é mais obrigatório aqui
            // document.querySelectorAll('input[name="contact-returned"]').forEach(r => r.required = true);
            // --- FIM DA CORREÇÃO 1 ---
            break;
        case 'visita':
            document.getElementById('visit-agent').required = true;
            document.getElementById('visit-date').required = true;
            // 'visitSucceeded' radio é obrigatório (já validado no submit)
            // Campos dentro de 'visit-contact-fields' tornam-se required via toggleVisitContactFields
            
            // --- INÍCIO DA CORREÇÃO 1 ---
            // 'visitReturned' radio NÃO é mais obrigatório aqui
            // document.querySelectorAll('input[name="visit-returned"]').forEach(r => r.required = true);
            // --- FIM DA CORREÇÃO 1 ---
            break;
        case 'encaminhamento_ct':
            document.getElementById('ct-sent-date').required = true;
            // 'ctFeedback' e 'ctReturned' são preenchidos DEPOIS, ao editar esta mesma ação
            break;
        case 'analise':
            document.getElementById('ct-parecer').required = true;
            break;
    }

    // --- Define a Data Mínima (CONSISTÊNCIA 2) ---
    let previousAction = null;
    if (isEditing) {
        const currentIndex = currentCycleActions.findIndex(a => a.id === data.id);
        if (currentIndex > 0) previousAction = currentCycleActions[currentIndex - 1];
    } else if (currentCycleActions.length > 0) {
        previousAction = currentCycleActions[currentCycleActions.length - 1];
    }

    if (previousAction) {
        const previousDateString = getActionMainDate(previousAction);
        if (previousDateString) {
            try {
                const previousDate = new Date(previousDateString + 'T00:00:00Z'); // Usa Z para UTC
                previousDate.setUTCDate(previousDate.getUTCDate() + 1); // Adiciona um dia em UTC
                const minDateString = previousDate.toISOString().split('T')[0];

                const currentActionDateInput = getDateInputForActionType(finalActionType);
                if (currentActionDateInput) {
                    currentActionDateInput.min = minDateString;
                    // Define valor padrão como a data mínima SE estiver criando e o campo estiver vazio
                    if (!isEditing && !currentActionDateInput.value) {
                       // currentActionDateInput.value = minDateString; // Opcional: pré-preencher com data mínima
                    }
                }
                 // Define min para contact-date também, se aplicável
                 if (finalActionType.startsWith('tentativa')) {
                     const contactDateInput = document.getElementById('contact-date');
                     if (contactDateInput) contactDateInput.min = minDateString;
                 }

            } catch (e) { console.error("Erro ao calcular data mínima:", e); }
        }
    }
    // --- Fim da Definição de Data Mínima ---

    // --- Preenchimento dos Dados (se Editando) ---
    if (isEditing) {
        // Preenche dados de edição específicos da ação
        switch (data.actionType) {
            case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
                document.getElementById('meeting-date').value = data.meetingDate || '';
                document.getElementById('meeting-time').value = data.meetingTime || '';
                // Lida com radio 'contactSucceeded'
                const contactSucceededRadio = document.querySelector(`input[name="contact-succeeded"][value="${data.contactSucceeded}"]`);
                if (contactSucceededRadio) {
                    contactSucceededRadio.checked = true;
                    toggleFamilyContactFields(data.contactSucceeded === 'yes', document.getElementById('family-contact-fields'));
                } else {
                     document.querySelectorAll(`input[name="contact-succeeded"]`).forEach(r => r.checked = false);
                     toggleFamilyContactFields(false, document.getElementById('family-contact-fields'));
                }
                // Preenche campos de detalhe do contato (se 'yes')
                document.getElementById('absence-contact-type').value = data.contactType || '';
                document.getElementById('contact-date').value = data.contactDate || '';
                document.getElementById('contact-person').value = data.contactPerson || '';
                document.getElementById('contact-reason').value = data.contactReason || '';
                // Lida com radio 'contactReturned'
                const contactReturnedRadio = document.querySelector(`input[name="contact-returned"][value="${data.contactReturned}"]`);
                if(contactReturnedRadio) contactReturnedRadio.checked = true;
                else document.querySelectorAll(`input[name="contact-returned"]`).forEach(r => r.checked = false);
                break;
            case 'visita':
                document.getElementById('visit-agent').value = data.visitAgent || '';
                document.getElementById('visit-date').value = data.visitDate || '';
                // Lida com radio 'visitSucceeded'
                const visitSucceededRadio = document.querySelector(`input[name="visit-succeeded"][value="${data.visitSucceeded}"]`);
                if(visitSucceededRadio) {
                    visitSucceededRadio.checked = true;
                    toggleVisitContactFields(data.visitSucceeded === 'yes', document.getElementById('visit-contact-fields'));
                } else {
                     document.querySelectorAll(`input[name="visit-succeeded"]`).forEach(r => r.checked = false);
                     toggleVisitContactFields(false, document.getElementById('visit-contact-fields'));
                }
                // Preenche campos de detalhe da visita (se 'yes')
                document.getElementById('visit-contact-person').value = data.visitContactPerson || '';
                document.getElementById('visit-reason').value = data.visitReason || '';
                document.getElementById('visit-obs').value = data.visitObs || '';
                // Lida com radio 'visitReturned'
                 const visitReturnedRadio = document.querySelector(`input[name="visit-returned"][value="${data.visitReturned}"]`);
                if (visitReturnedRadio) visitReturnedRadio.checked = true;
                else document.querySelectorAll(`input[name="visit-returned"]`).forEach(r => r.checked = false);
                break;
            case 'encaminhamento_ct':
                document.getElementById('ct-sent-date').value = data.ctSentDate || '';
                document.getElementById('ct-feedback').value = data.ctFeedback || ''; // Permite editar feedback
                // Lida com radio 'ctReturned' (permite editar)
                const ctReturnedRadio = document.querySelector(`input[name="ct-returned"][value="${data.ctReturned}"]`);
                if (ctReturnedRadio) ctReturnedRadio.checked = true;
                else document.querySelectorAll(`input[name="ct-returned"]`).forEach(r => r.checked = false);
                 // Campos de devolutiva e retorno tornam-se obrigatórios ao editar CT se ainda não preenchidos
                 document.getElementById('ct-feedback').required = true;
                 
                 // --- INÍCIO DA CORREÇÃO 1 ---
                 // Radio ctReturned fica obrigatório (força Sim ou Não)
                 document.querySelectorAll('input[name="ct-returned"]').forEach(r => r.required = true);
                 // --- FIM DA CORREÇÃO 1 ---
                break;
            case 'analise':
                document.getElementById('ct-parecer').value = data.ctParecer || '';
                break;
        }
    } else { // Se Criando
        // Garante que os campos dinâmicos comecem escondidos ao criar
        toggleFamilyContactFields(false, document.getElementById('family-contact-fields'));
        toggleVisitContactFields(false, document.getElementById('visit-contact-fields'));
         // Garante que rádios comecem desmarcados
        document.querySelectorAll('input[name="contact-succeeded"], input[name="visit-succeeded"], input[name="contact-returned"], input[name="visit-returned"], input[name="ct-returned"]').forEach(r => r.checked = false);
    }

    openModal(dom.absenceModal);
};


// --- Funções de Handler ---

/**
 * Lida com a submissão do formulário de Busca Ativa.
 * (MODIFICADO - CONSISTÊNCIA 2): Adiciona verificação final da data antes de salvar.
 */
async function handleAbsenceSubmit(e) {
    e.preventDefault();
    const form = e.target;
    // Força validação de campos required dinâmicos
    let firstInvalidField = null;
    form.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea:not([disabled])').forEach(el => {
        if (el.required && !el.value && el.type !== 'radio') {
             if (!firstInvalidField) firstInvalidField = el;
        }
         // Validação específica para grupos de radio required
         if (el.type === 'radio' && el.required) {
             const groupName = el.name;
             const group = form.querySelectorAll(`input[name="${groupName}"]:not([disabled])`);
             const isGroupChecked = Array.from(group).some(radio => radio.checked);
             if (!isGroupChecked && !firstInvalidField) {
                  // Encontra o primeiro radio do grupo para focar
                  firstInvalidField = group[0];
             }
         }
    });

    if (firstInvalidField) {
         showToast(`Por favor, preencha o campo obrigatório: ${firstInvalidField.labels?.[0]?.textContent || firstInvalidField.name}`);
         firstInvalidField.focus();
         // Simula a validação nativa visualmente, se possível
         if (typeof firstInvalidField.reportValidity === 'function') {
             firstInvalidField.reportValidity();
         }
         return;
    }


    const data = getAbsenceFormData();
    if (!data) return; // getAbsenceFormData já pode mostrar toast se aluno for inválido

    // --- Validação Final da Data (CONSISTÊNCIA 2) ---
    const currentDateString = getActionMainDate(data);

    if (currentDateString) { // Só valida se a ação atual tem uma data principal
        const { currentCycleActions } = getStudentProcessInfo(data.studentId);
        currentCycleActions.sort((a, b) => { // Ordena igual ao modal
            const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
            const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
            const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
            const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
             if (timeA === timeB) {
                 const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
                 const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
                 return (createA || 0) - (createB || 0);
             }
            return (timeA || 0) - (timeB || 0);
        });

        let previousAction = null;
        if (data.id) { // Editando
            // Encontra a ação ANTERIOR à que está sendo editada
            const currentIndex = currentCycleActions.findIndex(a => a.id === data.id);
            if (currentIndex > 0) {
                previousAction = currentCycleActions[currentIndex - 1];
            }
        } else { // Adicionando
            // A ação anterior é a última existente no ciclo
            if (currentCycleActions.length > 0) {
                previousAction = currentCycleActions[currentCycleActions.length - 1];
            }
        }

        if (previousAction) {
            const previousDateString = getActionMainDate(previousAction);
            if (previousDateString) {
                // Compara as datas YYYY-MM-DD
                if (currentDateString <= previousDateString) {
                    return showToast(`Erro: A data da ação (${formatDate(currentDateString)}) deve ser posterior à data da ação anterior (${formatDate(previousDateString)}).`);
                }
            }
        }

        // Validação extra para contactDate vs meetingDate na mesma ação de tentativa
        if (data.actionType.startsWith('tentativa') && data.contactDate && data.meetingDate) {
             if (data.contactDate < data.meetingDate) {
                 return showToast(`Erro: A data do contato (${formatDate(data.contactDate)}) não pode ser anterior à data da convocação (${formatDate(data.meetingDate)}).`);
             }
        }

    }
    // --- Fim da Validação Final da Data ---


    // --- Lógica de salvar ---
    try {
        const id = data.id; // Guarda o ID original (se existir)
        const historyAction = id ? "Dados da ação atualizados." : `Ação de Busca Ativa registada (${actionDisplayTitles[data.actionType]}).`;

        if (id) {
            // Se está editando, usa o ID para atualizar o documento correto
            // Remove o ID do objeto de dados para não tentar salvar o ID como um campo
            const updateData = { ...data };
            delete updateData.id;
            await updateRecordWithHistory('absence', id, updateData, historyAction, state.userEmail);
        } else {
            // Se está adicionando, não passa ID
            // Remove o ID (que estaria vazio) do objeto de dados
             const addData = { ...data };
             delete addData.id;
            await addRecordWithHistory('absence', addData, historyAction, state.userEmail);
        }

        showToast(`Ação ${id ? 'atualizada' : 'registada'} com sucesso!`);
        closeModal(dom.absenceModal);

        // --- Lógica pós-salvamento (sugerir 'analise') ---
        const studentReturned = (data.contactReturned === 'yes' || data.visitReturned === 'yes' || data.ctReturned === 'yes');
        // A lógica de sugerir 'analise' só faz sentido se a ação salva NÃO for 'analise'
        if (studentReturned && data.actionType !== 'analise') {
            const student = state.students.find(s => s.matricula === data.studentId);
             // Usar delay para dar tempo ao listener onSnapshot de atualizar o state
             setTimeout(() => {
                 // Re-busca as informações do processo APÓS o state ter sido atualizado pelo listener
                 const { currentCycleActions: updatedActions } = getStudentProcessInfo(data.studentId); // Usa studentId de `data`
                 // Verifica se o aluno existe E se ainda não há uma ação de análise no ciclo atualizado
                 if (student && !updatedActions.some(a => a.actionType === 'analise')) {
                    openAbsenceModalForStudent(student, 'analise'); // Sugere a próxima etapa
                 }
             }, 400); // Aumentado um pouco
        }
    } catch (error) {
        console.error("Erro ao salvar ação de BA:", error);
        showToast('Erro ao salvar ação.');
    }
}


/**
 * Coleta os dados do formulário de Busca Ativa.
 * (Garante que ID está presente)
 */
function getAbsenceFormData() {
    const studentName = document.getElementById('absence-student-name').value.trim();
    const student = state.students.find(s => s.name === studentName);
    if (!student) {
        showToast("Aluno inválido.");
        return null;
    }

    const data = {
        id: document.getElementById('absence-id').value, // ID é crucial
        studentId: student.matricula,
        actionType: document.getElementById('action-type').value,
        processId: document.getElementById('absence-process-id').value,
        // Dados de Faltas (podem ser null se readOnly)
        periodoFaltasStart: document.getElementById('absence-start-date').value || null,
        periodoFaltasEnd: document.getElementById('absence-end-date').value || null,
        absenceCount: document.getElementById('absence-count').value || null,
         // Inicializa todos os campos específicos como null
        meetingDate: null, meetingTime: null, contactSucceeded: null, contactType: null, contactDate: null, contactPerson: null, contactReason: null, contactReturned: null,
        visitAgent: null, visitDate: null, visitSucceeded: null, visitContactPerson: null, visitReason: null, visitObs: null, visitReturned: null,
        ctSentDate: null, ctFeedback: null, ctReturned: null, oficioNumber: null, oficioYear: null,
        ctParecer: null
    };

    // Preenche os dados específicos da ação atual
    if (data.actionType.startsWith('tentativa')) {
        const contactSucceededRadio = document.querySelector('input[name="contact-succeeded"]:checked');
        data.meetingDate = document.getElementById('meeting-date').value || null;
        data.meetingTime = document.getElementById('meeting-time').value || null;
        data.contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;
        if (data.contactSucceeded === 'yes') {
            data.contactType = document.getElementById('absence-contact-type').value || null;
            data.contactDate = document.getElementById('contact-date').value || null;
            data.contactPerson = document.getElementById('contact-person').value.trim() || null;
            data.contactReason = document.getElementById('contact-reason').value.trim() || null;
        }
        const contactReturnedRadio = document.querySelector('input[name="contact-returned"]:checked');
        data.contactReturned = contactReturnedRadio ? contactReturnedRadio.value : null;
    } else if (data.actionType === 'visita') {
        const visitSucceededRadio = document.querySelector('input[name="visit-succeeded"]:checked');
        data.visitAgent = document.getElementById('visit-agent').value.trim() || null;
        data.visitDate = document.getElementById('visit-date').value || null;
        data.visitSucceeded = visitSucceededRadio ? visitSucceededRadio.value : null;
        if (data.visitSucceeded === 'yes') {
            data.visitContactPerson = document.getElementById('visit-contact-person').value.trim() || null;
            data.visitReason = document.getElementById('visit-reason').value.trim() || null;
            data.visitObs = document.getElementById('visit-obs').value.trim() || null;
        }
        const visitReturnedRadio = document.querySelector('input[name="visit-returned"]:checked');
        data.visitReturned = visitReturnedRadio ? visitReturnedRadio.value : null;
    } else if (data.actionType === 'encaminhamento_ct') {
        data.ctSentDate = document.getElementById('ct-sent-date').value || null;
        data.ctFeedback = document.getElementById('ct-feedback').value.trim() || null; // Coleta feedback aqui
        const ctReturnedRadio = document.querySelector('input[name="ct-returned"]:checked');
        data.ctReturned = ctReturnedRadio ? ctReturnedRadio.value : null; // Coleta retorno aqui
         // Coleta dados do ofício se já existirem (ao editar)
         const existingAction = state.absences.find(a => a.id === data.id);
         if (existingAction) {
             data.oficioNumber = existingAction.oficioNumber; // Mantém número original
             data.oficioYear = existingAction.oficioYear; // Mantém ano original
         }
    } else if (data.actionType === 'analise') {
        data.ctParecer = document.getElementById('ct-parecer').value.trim() || null;
    }
    return data;
}


/**
 * Mostra/esconde campos dinâmicos no modal de Busca Ativa.
 */
function handleActionTypeChange(action) {
    document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));
    const groupToShow = action.startsWith('tentativa') ? 'group-tentativas' : `group-${action}`;
    const groupElement = document.getElementById(groupToShow);
    if (groupElement) groupElement.classList.remove('hidden');
}

/**
 * Lida com o clique de "Enviar ao CT".
 */
async function handleSendToCT(id) {
    const visitAction = state.absences.find(a => a.id === id); // Pega a ação de Visita (origem)
    if (!visitAction) return showToast("Ação de visita não encontrada.");
    // Verifica se a visita foi concluída (sucesso preenchido)
    if (visitAction.visitSucceeded == null) {
        return showToast("Complete os dados da visita (sucesso Sim/Não) antes de enviar ao CT.");
    }
    // --- CORREÇÃO (SOLICITAÇÃO DO USUÁRIO) ---
    // Verifica se a visita foi concluída (retorno preenchido)
    if (visitAction.visitReturned == null) {
        return showToast("Complete os dados da visita (Aluno retornou? Sim/Não) antes de enviar ao CT.");
    }
    // --- FIM DA CORREÇÃO ---


    const oficioNumber = prompt("Por favor, insira o número do ofício:");
    if (oficioNumber?.trim()) {
        const student = state.students.find(s => s.matricula === visitAction.studentId);
        if (!student) return showToast("Aluno não encontrado.");

        const { processId, currentCycleActions } = getStudentProcessInfo(student.matricula);
        
        // Verifica se já existe uma ação de encaminhamento NESTE CICLO
        if (currentCycleActions.some(a => a.actionType === 'encaminhamento_ct')) {
            showToast("Encaminhamento já realizado neste ciclo.");
            return;
        }

        // Pega os dados de falta da primeira ação do ciclo
        const firstAction = currentCycleActions.find(a => a.periodoFaltasStart);
        const dataForCt = {
            studentId: student.matricula,
            actionType: 'encaminhamento_ct',
            processId,
            ctSentDate: new Date().toISOString().split('T')[0], // Data atual
            oficioNumber: oficioNumber.trim(), // Garante que não tem espaços extras
            oficioYear: new Date().getFullYear(),
            // Copia dados de falta da primeira ação, se existirem
            periodoFaltasStart: firstAction?.periodoFaltasStart || visitAction.periodoFaltasStart || null, // Fallback para dados da visita
            periodoFaltasEnd: firstAction?.periodoFaltasEnd || visitAction.periodoFaltasEnd || null,
            absenceCount: firstAction?.absenceCount || visitAction.absenceCount || null,
            // Inicializa campos de feedback e retorno
            ctFeedback: null,
            ctReturned: null
        };
        
        // Validação final de data: ctSentDate deve ser >= visitDate
        if (dataForCt.ctSentDate < visitAction.visitDate) {
             return showToast(`Erro: A data de envio ao CT (${formatDate(dataForCt.ctSentDate)}) não pode ser anterior à data da visita (${formatDate(visitAction.visitDate)}).`);
        }

        try {
            const historyAction = `Ação 'Encaminhamento ao CT' registada (Ofício Nº ${dataForCt.oficioNumber}/${dataForCt.oficioYear}).`;
            const docRef = await addRecordWithHistory('absence', dataForCt, historyAction, state.userEmail);
            showToast("Registro de 'Encaminhamento ao CT' salvo automaticamente.");

            // Prepara dados para gerar o ofício imediatamente
            const newActionDataForReport = {
                ...dataForCt,
                id: docRef.id, // ID do novo documento criado
                createdAt: new Date(), // Simula timestamp para o relatório
                history: [{ action: historyAction, user: state.userEmail, timestamp: new Date() }]
            };
            generateAndShowOficio(newActionDataForReport, dataForCt.oficioNumber); // Passa o número explicitamente

        } catch(err) {
            console.error("Erro ao salvar ou gerar ofício:", err);
            showToast("Erro ao salvar o encaminhamento automático.");
        }
    } else if (oficioNumber !== null) { // Só mostra erro se não cancelou o prompt
        showToast("Número do ofício inválido.");
    }
}


/**
 * Lida com o clique de "Ver Ofício".
 */
function handleViewOficio(id) {
    const ctAction = state.absences.find(a => a.id === id);
    if (ctAction && ctAction.oficioNumber) {
        generateAndShowOficio(ctAction, ctAction.oficioNumber); // Passa a ação e o número
    } else {
        showToast("Registro de encaminhamento ou número do ofício não encontrado.");
    }
}


/**
 * Lida com o clique no nome do aluno (iniciar nova ação).
 * (MODIFICADO V4) - Agora chamado pelo botão "Avançar Etapa".
 */
function handleNewAbsenceFromHistory(studentId) {
    const student = state.students.find(s => s.matricula === studentId);
    if (student) handleNewAbsenceAction(student); // Reutiliza a lógica principal
}


/**
 * Lida com a edição de uma ação (chamado pelo listener).
 */
function handleEditAbsence(id) {
    // A função já contém a lógica de verificação se pode editar (ser a última ação)
    // Busca a ação para editar
    const data = state.absences.find(a => a.id === id);
    if (!data) return showToast("Ação não encontrada.");

    // Busca as ações do processo para verificar se é a última
    const processActions = state.absences
        .filter(a => a.processId === data.processId)
        .sort((a, b) => { // Ordena para garantir
            const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
            const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
            const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
            const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
             if (timeA === timeB) {
                 const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
                 const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
                 return (createA || 0) - (createB || 0);
             }
            return (timeA || 0) - (timeB || 0);
        });

    const lastProcessAction = processActions[processActions.length - 1];
    const isConcluded = processActions.some(a => a.actionType === 'analise');

    // Verifica se pode editar
    if (isConcluded || data.id !== lastProcessAction?.id) { // Adiciona ?.id por segurança
        return showToast(isConcluded ? "Processo concluído, não pode editar." : "Apenas a última ação pode ser editada.");
    }

    // Se pode editar, abre o modal
    const student = state.students.find(s => s.matricula === data.studentId);
    if (student) {
        openAbsenceModalForStudent(student, data.actionType, data); // Abre para editar
    } else {
        showToast("Aluno associado não encontrado.");
    }
}


/**
 * Lida com a exclusão de uma ação (chamado pelo listener).
 * (MODIFICADO V4) - Agora chamado pelo botão "Limpar Ação".
 * A lógica de "Limpar" na Busca Ativa é excluir a última ação (documento).
 */
function handleDeleteAbsence(id) {
    const actionToDelete = state.absences.find(a => a.id === id);
    if (!actionToDelete) return;

    // --- Verificação de Consistência ---
    const processActions = state.absences
        .filter(a => a.processId === actionToDelete.processId)
        .sort((a, b) => { // Ordena igual ao render/edit
            const dateA = getActionMainDate(a) || a.createdAt?.seconds || 0;
            const dateB = getActionMainDate(b) || b.createdAt?.seconds || 0;
            const timeA = typeof dateA === 'string' ? new Date(dateA+'T00:00:00Z').getTime() : (dateA instanceof Date ? dateA.getTime() : (dateA || 0) * 1000);
            const timeB = typeof dateB === 'string' ? new Date(dateB+'T00:00:00Z').getTime() : (dateB instanceof Date ? dateB.getTime() : (dateB || 0) * 1000);
             if (timeA === timeB) {
                 const createA = a.createdAt?.seconds || (a.createdAt instanceof Date ? a.createdAt.getTime() / 1000 : 0);
                 const createB = b.createdAt?.seconds || (b.createdAt instanceof Date ? b.createdAt.getTime() / 1000 : 0);
                 return (createA || 0) - (createB || 0);
             }
            return (timeA || 0) - (timeB || 0);
        });

    const lastProcessAction = processActions.length > 0 ? processActions[processActions.length - 1] : null;
    const isConcluded = processActions.some(a => a.actionType === 'analise');

    // Impede a exclusão se o processo estiver concluído OU se não for a última ação
    if (isConcluded || !lastProcessAction || actionToDelete.id !== lastProcessAction.id) {
        return showToast(isConcluded ? "Processo concluído, não pode excluir." : "Apenas a última ação pode ser excluída.");
    }
    // --- Fim da Verificação ---

    // Define a mensagem e o registro a ser excluído (lógica simplificada, sem cascata por enquanto)
    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja Limpar esta ação? Esta ação não pode ser desfeita.';
    state.recordToDelete = { type: 'absence', id: id };
    openModal(dom.deleteConfirmModal);
}


// --- Função Principal de Inicialização ---

// =================================================================================
// --- INÍCIO DA REESCRITA (initAbsenceListeners) ---
// Função reescrita para controlar o acordeão e os novos botões (V4).
// =================================================================================
/**
 * Anexa todos os listeners de eventos relacionados a Busca Ativa.
 */
export const initAbsenceListeners = () => {
    // Relatório Geral
    document.getElementById('general-ba-report-btn').addEventListener('click', generateAndShowBuscaAtivaReport);

    // Filtros
    document.getElementById('filter-process-status').addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; renderAbsences(); });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; renderAbsences(); });
    document.getElementById('filter-return-status').addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; renderAbsences(); });
    // Listeners dos Filtros de Data
    document.getElementById('absence-start-date-filter').addEventListener('change', (e) => {
        state.filtersAbsences.startDate = e.target.value;
        renderAbsences();
    });
    document.getElementById('absence-end-date-filter').addEventListener('change', (e) => {
        state.filtersAbsences.endDate = e.target.value;
        renderAbsences();
    });

    // Autocomplete da Busca
    setupAbsenceAutocomplete();

    // Formulário
    dom.absenceForm.addEventListener('submit', handleAbsenceSubmit);
    
    // Rádios de contato (no modal) - para mostrar/esconder campos
    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'))));
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'))));

    // Listener de clique para a lista (delegação de eventos)
    dom.absencesListDiv.addEventListener('click', (e) => {
        
        // Prioridade 1: Clique em um Botão (dentro ou fora do acordeão)
        const button = e.target.closest('button');
        if (button) {
            e.stopPropagation(); // Impede que o clique no botão ative o acordeão
            
            // Ações DENTRO do Acordeão
            if (button.closest('.process-content')) {
                const id = button.dataset.id; // ID da Ação
                
                // Botão Avançar Etapa
                if (button.classList.contains('avancar-etapa-btn') && !button.disabled) {
                    handleNewAbsenceFromHistory(button.dataset.studentId);
                    return;
                }
                // Botão Editar Ação
                if (button.classList.contains('edit-absence-action-btn') && !button.disabled) {
                    handleEditAbsence(id);
                    return;
                }
                // Botão Limpar Ação
                if (button.classList.contains('reset-absence-action-btn') && !button.disabled) {
                    handleDeleteAbsence(id); // "Limpar" na BA é excluir a última ação
                    return;
                }
                // Botões de Ação Específicos (Notificação, Enviar CT, Ver Ofício)
                if (button.classList.contains('notification-btn') && id) { openFichaViewModal(id); return; }
                if (button.classList.contains('send-ct-btn') && id) { handleSendToCT(id); return; }
                if (button.classList.contains('view-oficio-btn') && id) { handleViewOficio(id); return; }
            }
            
            // Ações FORA do Acordeão (Cabeçalho do Processo)
            
            // Botão Gerar Ficha Consolidada
            if (button.classList.contains('generate-ficha-btn-row')) {
                 generateAndShowConsolidatedFicha(button.dataset.studentId, button.dataset.processId);
                 return;
            }

            // (Não há Kebab no cabeçalho da BA, diferente das Ocorrências)
            
            return; // Outro botão (talvez Kebab antigo?)
        } // Fim do if(button)

        // Prioridade 2: Clique no cabeçalho para ACORDEÃO
        const header = e.target.closest('.process-header');
        if (header) {
            // Não precisa de stopPropagation aqui
            const contentId = header.dataset.contentId;
            const content = document.getElementById(contentId);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
                if (isHidden) {
                    content.style.maxHeight = `${content.scrollHeight}px`;
                    content.style.overflow = 'visible';
                } else {
                    content.style.maxHeight = null;
                     setTimeout(() => content.style.overflow = 'hidden', 300);
                }
                icon?.classList.toggle('rotate-180', isHidden);
            }
            return; // Clique no cabeçalho tratado
        }
        
    }); // Fim do listener absencesListDiv
};
// =================================================================================
// --- FIM DA REESCRITA (initAbsenceListeners) ---
// =================================================================================
