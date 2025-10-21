// =================================================================================
// ARQUIVO: ui.js
// RESPONSABILIDADE: Todas as funções que manipulam a UI (desenhar,
// abrir modais, gerar HTML).
// ATUALIZAÇÃO GERAL (Conforme Análise):
// 1. (Item 1) `openIndividualNotificationModal`: Totalmente reescrita para ser uma
//    notificação formal, com legislação, data de envio e remoção de campos sensíveis.
// 2. (Item 2, 9) `openOccurrenceModal` e `openAbsenceModalForStudent`: Atualizadas
//    para popular os novos campos de contato (tipo, data) no modo de edição.
// 3. (Item 3, 4, 10) `renderOccurrences`: Botão "Olho" trocado por "Notificação".
//    Adicionado botão "Gerar Ata" (Item 4) e botões secundários movidos
//    para um menu "..." (kebab) (Item 10).
// 4. (Item 4) Nova função: `openOccurrenceRecordModal` (Ata Formal para impressão).
// 5. (Item 5) Todos os relatórios/fichas incluem agora o Logo da Escola.
// 6. (Item 6) `renderAbsences` atualizada com botão "Histórico" no menu "...".
// 7. (Item 6) Nova função: `openAbsenceHistoryModal`.
// 8. (Item 7) `generateAndShowGeneralReport`: Reesctruturado com layout "dashboard",
//    placeholders para gráficos e inclusão de campos de providências.
// 9. (Item 10) `renderAbsences`: Botões secundários movidos para menu "...".
// 10. (Item 11) Nova função: `generateAndShowBuscaAtivaReport` (Relatório Geral de BA).
// =================================================================================

import { state, dom } from './state.js';
// ATUALIZADO: Assumindo que 'config' virá do 'state.js' futuramente
// import { config } from './firebase.js'; 
import { getStudentProcessInfo, determineNextActionForStudent } from './logic.js';
import { formatDate, formatTime, formatText, formatPeriodo, showToast, openModal, closeModal } from './utils.js';
import { getStudentsDocRef } from './firestore.js';
import { setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


// =================================================================================
// SEÇÃO 1: LÓGICA DA NOVA INTERFACE DE OCORRÊNCIAS
// =================================================================================

/**
 * (Inalterado)
 * Gerencia a UI do componente de seleção de múltiplos alunos ("Tag Input").
 * @param {HTMLInputElement} inputElement - O campo de texto para pesquisar alunos.
 * @param {HTMLDivElement} suggestionsElement - O container para exibir as sugestões.
 * @param {HTMLDivElement} tagsContainerElement - O container onde as "tags" dos alunos selecionados serão exibidas.
 */
export const setupStudentTagInput = (inputElement, suggestionsElement, tagsContainerElement) => {
    // Função interna para redesenhar as tags com base no estado atual.
    const renderTags = () => {
        tagsContainerElement.innerHTML = ''; // Limpa o container
        if (state.selectedStudents.size === 0) {
            tagsContainerElement.innerHTML = `<p class="text-sm text-gray-400">Pesquise e selecione um ou mais alunos...</p>`;
            return;
        }
        
        state.selectedStudents.forEach((student, studentId) => {
            const tag = document.createElement('span');
            tag.className = 'bg-indigo-100 text-indigo-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded-full flex items-center';
            tag.innerHTML = `${student.name} <button type="button" class="ms-2 text-indigo-600 hover:text-indigo-800">&times;</button>`;
            
            // Adiciona evento para remover o aluno ao clicar no "X".
            tag.querySelector('button').addEventListener('click', () => {
                state.selectedStudents.delete(studentId);
                renderTags(); // Re-renderiza as tags
            });
            tagsContainerElement.appendChild(tag);
        });
    };

    // Evento de digitação no campo de busca.
    inputElement.addEventListener('input', () => {
        const value = inputElement.value.toLowerCase();
        suggestionsElement.innerHTML = '';
        if (!value) {
            suggestionsElement.classList.add('hidden');
            return;
        }
        
        // Filtra alunos que ainda não foram selecionados.
        const filteredStudents = state.students
            .filter(s => !state.selectedStudents.has(s.matricula) && s.name.toLowerCase().includes(value))
            .slice(0, 5);
        
        if (filteredStudents.length > 0) {
            suggestionsElement.classList.remove('hidden');
            filteredStudents.forEach(student => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = student.name;
                item.addEventListener('click', () => {
                    // Adiciona o aluno ao Map de selecionados.
                    state.selectedStudents.set(student.matricula, student);
                    inputElement.value = ''; // Limpa o campo de busca
                    suggestionsElement.classList.add('hidden');
                    renderTags(); // Atualiza a exibição das tags
                });
                suggestionsElement.appendChild(item);
            });
        } else {
            suggestionsElement.classList.add('hidden');
        }
    });
    
    // Esconde sugestões se o usuário clicar fora.
    document.addEventListener('click', (e) => {
        if (!suggestionsElement.contains(e.target) && e.target !== inputElement) {
            suggestionsElement.classList.add('hidden');
        }
    });

    renderTags(); // Renderiza o estado inicial (que foi preparado por `openOccurrenceModal`).
};


/**
 * (Inalterado)
 * Gera o "selo" de status com novas cores e o status "Finalizada".
 * @param {string} status - O status da ocorrência.
 * @returns {string} HTML do selo de status.
 */
const getStatusBadge = (status) => {
    const statusMap = {
        'Pendente': 'bg-yellow-100 text-yellow-800',
        'Finalizada': 'bg-green-100 text-green-800',
        'Cancelado': 'bg-gray-100 text-gray-800'
    };
    const colorClasses = statusMap[status] || 'bg-gray-100 text-gray-800';
    return `<span class="text-xs font-medium px-2.5 py-0.5 rounded-full ${colorClasses}">${status || 'N/A'}</span>`;
};


/**
 * (Inalterado)
 * Filtra as ocorrências com base nos novos filtros de status, tipo e aluno.
 * @returns {Map<string, object>} Um Map onde a chave é o `occurrenceGroupId` e o valor é um objeto do incidente.
 */
export const getFilteredOccurrences = () => {
    // 1. Agrupa todas as ocorrências por `occurrenceGroupId`.
    const groupedByIncident = state.occurrences.reduce((acc, occ) => {
        // ATUALIZADO: Lógica de ID de grupo (Item 8 - Preparação)
        // Usa o occurrenceGroupId. Se não existir, tenta o processId (para BA antigas?), senão ID individual.
        const groupId = occ.occurrenceGroupId || occ.processId || `individual-${occ.id}`;
        
        if (!acc.has(groupId)) {
            acc.set(groupId, {
                id: groupId,
                records: [], 
                studentsInvolved: new Map() 
            });
        }
        const incident = acc.get(groupId);
        incident.records.push(occ);
        
        const student = state.students.find(s => s.matricula === occ.studentId);
        if (student) {
            incident.studentsInvolved.set(student.matricula, student);
        }
        return acc;
    }, new Map());

    // 2. Filtra os incidentes agrupados com base nos filtros da UI.
    const filteredIncidents = new Map();
    for (const [groupId, incident] of groupedByIncident.entries()) {
        const mainRecord = incident.records[0]; 
        const { startDate, endDate, status, type } = state.filtersOccurrences;
        const studentSearch = state.filterOccurrences.toLowerCase();

        // Checagem de filtros
        if (startDate && mainRecord.date < startDate) continue;
        if (endDate && mainRecord.date > endDate) continue;
        if (status !== 'all' && mainRecord.status !== status) continue;
        if (type !== 'all' && mainRecord.occurrenceType !== type) continue;
        
        // Checagem do filtro de busca por aluno
        if (studentSearch) {
            const hasMatchingStudent = [...incident.studentsInvolved.values()].some(s => 
                s.name.toLowerCase().includes(studentSearch)
            );
            if (!hasMatchingStudent) continue;
        }

        filteredIncidents.set(groupId, incident);
    }
    return filteredIncidents;
};


/**
 * ATUALIZADO: (Item 3, 4, 10) Renderiza a lista de ocorrências com botões de ação reorganizados.
 */
export const renderOccurrences = () => {
    dom.loadingOccurrences.classList.add('hidden');
    
    const filteredIncidents = getFilteredOccurrences();
    
    dom.occurrencesTitle.textContent = `Exibindo ${filteredIncidents.size} Incidente(s)`;

    if (filteredIncidents.size === 0) {
         dom.emptyStateOccurrences.classList.remove('hidden');
         dom.occurrencesListDiv.innerHTML = '';
         return;
    }

    dom.emptyStateOccurrences.classList.add('hidden');
    
    // Ordena os incidentes pela data do mais recente para o mais antigo.
    const sortedIncidents = [...filteredIncidents.values()].sort((a, b) => 
        new Date(b.records[0].date) - new Date(a.records[0].date)
    );

    let html = sortedIncidents.map(incident => {
        const mainRecord = incident.records[0];
        const studentNames = [...incident.studentsInvolved.values()].map(s => s.name).join(', ');

        // ATUALIZADO: (Item 3, 4, 10) Lógica dos botões
        return `
            <div class="border rounded-lg overflow-hidden bg-white shadow-sm">
                <div class="p-4 flex flex-col sm:flex-row justify-between items-start gap-3">
                    <div class="flex-grow">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="font-semibold text-gray-800">${mainRecord.occurrenceType || 'N/A'}</span>
                            ${getStatusBadge(mainRecord.status)}
                        </div>
                        <p class="text-sm text-gray-600"><strong>Alunos:</strong> ${studentNames}</p>
                        <p class="text-xs text-gray-400 mt-1">Data: ${formatDate(mainRecord.date)} | ID: ${incident.id}</p>
                    </div>
                    
                    <div class="flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 self-stretch sm:self-center">
                        <button class="notification-btn text-indigo-600 hover:text-indigo-900 text-xs font-semibold py-2 px-3 rounded-md bg-indigo-50 hover:bg-indigo-100 text-center" data-group-id="${incident.id}" title="Gerar Notificação">
                            <i class="fas fa-paper-plane mr-1"></i> Notificação
                        </button>
                        <button class="record-btn text-gray-600 hover:text-gray-900 text-xs font-semibold py-2 px-3 rounded-md bg-gray-50 hover:bg-gray-100 border border-gray-300 text-center" data-group-id="${incident.id}" title="Gerar Ata de Ocorrência">
                            <i class="fas fa-file-invoice mr-1"></i> Gerar Ata
                        </button>
                        
                        <div class="relative kebab-menu-container self-center">
                            <button class="kebab-menu-btn text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100" data-group-id="${incident.id}" title="Mais Opções">
                                <i class="fas fa-ellipsis-v"></i>
                            </button>
                            <div class="kebab-menu-dropdown hidden absolute right-0 mt-1 w-40 bg-white rounded-md shadow-lg border z-10">
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="history" data-group-id="${incident.id}">
                                    <i class="fas fa-history mr-2 w-4"></i>Histórico
                                </button>
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="edit" data-group-id="${incident.id}">
                                    <i class="fas fa-pencil-alt mr-2 w-4"></i>Editar
                                </button>
                                <button class="kebab-action-btn menu-item menu-item-danger w-full text-left" data-action="delete" data-group-id="${incident.id}">
                                    <i class="fas fa-trash mr-2 w-4"></i>Excluir
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    dom.occurrencesListDiv.innerHTML = html;
};


/**
 * ATUALIZADO: (Item 2) Abre o modal de ocorrência, populando os novos campos de contato.
 * @param {object | null} incidentToEdit - O objeto do incidente a ser editado, ou null para criar um novo.
 */
export const openOccurrenceModal = (incidentToEdit = null) => {
    // 1. Limpa o formulário e o estado de alunos selecionados.
    dom.occurrenceForm.reset();
    state.selectedStudents.clear();

    // Desativa os campos dinâmicos por padrão
    toggleFamilyContactFields(false, document.getElementById('occurrence-family-contact-fields'));

    if (incidentToEdit) {
        // 2. MODO DE EDIÇÃO: Prepara o estado e os campos do formulário.
        const mainRecord = incidentToEdit.records[0];
        document.getElementById('modal-title').innerText = 'Editar Registro de Ocorrência';
        document.getElementById('occurrence-group-id').value = incidentToEdit.id;

        // Popula o estado com os alunos envolvidos no incidente.
        incidentToEdit.studentsInvolved.forEach((student, studentId) => {
            state.selectedStudents.set(studentId, student);
        });

        // Preenche o resto do formulário.
        document.getElementById('occurrence-type').value = mainRecord.occurrenceType || '';
        document.getElementById('occurrence-date').value = mainRecord.date || '';
        
        // Convocação (movida para cima)
        document.getElementById('meeting-date-occurrence').value = mainRecord.meetingDate || '';
        document.getElementById('meeting-time-occurrence').value = mainRecord.meetingTime || '';
        
        // NOVOS CAMPOS DE CONTATO (Item 2)
        if(mainRecord.contactSucceeded) {
            const radio = document.querySelector(`input[name="occurrence-contact-succeeded"][value="${mainRecord.contactSucceeded}"]`);
            if (radio) {
                radio.checked = true;
                // Dispara o evento 'change' para mostrar/ocultar campos
                radio.dispatchEvent(new Event('change'));
            }
        }
        document.getElementById('occurrence-contact-type').value = mainRecord.contactType || '';
        document.getElementById('occurrence-contact-date').value = mainRecord.contactDate || '';
        
        // Campos originais
        document.getElementById('description').value = mainRecord.description || '';
        document.getElementById('actions-taken-school').value = mainRecord.actionsTakenSchool || '';
        document.getElementById('actions-taken-family').value = mainRecord.actionsTakenFamily || '';
        document.getElementById('occurrence-parecer').value = mainRecord.parecer || '';
        
    } else {
        // 3. MODO DE CRIAÇÃO: Define os valores padrão.
        document.getElementById('modal-title').innerText = 'Registar Nova Ocorrência';
        document.getElementById('occurrence-group-id').value = '';
        document.getElementById('occurrence-date').valueAsDate = new Date();
    }

    // 4. INICIALIZA O COMPONENTE DE UI: Agora que o estado está correto, a UI é renderizada.
    const studentInput = document.getElementById('student-search-input');
    const suggestionsDiv = document.getElementById('student-suggestions');
    const tagsContainer = document.getElementById('student-tags-container');
    setupStudentTagInput(studentInput, suggestionsDiv, tagsContainer);

    // 5. Abre o modal.
    openModal(dom.occurrenceModal);
};

// =================================================================================
// SEÇÃO 2: LÓGICA DA INTERFACE DE BUSCA ATIVA
// =================================================================================
export const actionDisplayTitles = {
    tentativa_1: "1ª Tentativa de Contato",
    tentativa_2: "2ª Tentativa de Contato",
    tentativa_3: "3ª Tentativa de Contato",
    visita: "Visita In Loco",
    encaminhamento_ct: "Encaminhamento ao Conselho Tutelar",
    analise: "Análise"
};

/**
 * ATUALIZADO: (Item 6, 10) Renderiza a lista de Busca Ativa com botões de ação reorganizados.
 */
export const renderAbsences = () => {
    dom.loadingAbsences.classList.add('hidden');

    const searchFiltered = state.absences
        .filter(a => {
            const student = state.students.find(s => s.matricula === a.studentId);
            return student && student.name.toLowerCase().startsWith(state.filterAbsences.toLowerCase());
        });

    const groupedByProcess = searchFiltered.reduce((acc, action) => {
        const key = action.processId || `no-proc-${action.id}`; 
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(action);
        return acc;
    }, {});

    const filteredGroupKeys = Object.keys(groupedByProcess).filter(processId => {
        const actions = groupedByProcess[processId];
        actions.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
        
        const { processStatus, pendingAction, returnStatus } = state.filtersAbsences;

        const isConcluded = actions.some(a => a.actionType === 'analise');
        if (processStatus === 'in_progress' && isConcluded) return false;
        if (processStatus === 'concluded' && !isConcluded) return false;

        const lastAction = actions[actions.length - 1];
        if (pendingAction !== 'all') {
            if (isConcluded) return false;

            if (pendingAction === 'pending_contact') {
                const isPendingContact = (lastAction.actionType.startsWith('tentativa') && lastAction.contactSucceeded == null) || (lastAction.actionType === 'visita' && lastAction.visitSucceeded == null);
                if (!isPendingContact) return false;
            }
            if (pendingAction === 'pending_feedback') {
                const hasCtAction = actions.some(a => a.actionType === 'encaminhamento_ct');
                const ctAction = actions.find(a => a.actionType === 'encaminhamento_ct');
                const isPendingFeedback = hasCtAction && !ctAction.ctFeedback;
                if (!isPendingFeedback) return false;
            }
        }

        if (returnStatus !== 'all') {
            const lastActionWithReturnInfo = [...actions].reverse().find(a => 
                (a.contactReturned !== undefined && a.contactReturned !== null) ||
                (a.visitReturned !== undefined && a.visitReturned !== null) ||
                (a.ctReturned !== undefined && a.ctReturned !== null)
            );

            if (!lastActionWithReturnInfo) {
                if (returnStatus === 'returned' || returnStatus === 'not_returned') return false;
            } else {
                const lastStatus = lastActionWithReturnInfo.contactReturned || lastActionWithReturnInfo.visitReturned || lastActionWithReturnInfo.ctReturned;

                if (returnStatus === 'returned' && lastStatus !== 'yes') {
                    return false;
                }
                if (returnStatus === 'not_returned' && lastStatus !== 'no') {
                    return false;
                }
            }
        }
        
        return true;
    });

    if (filteredGroupKeys.length === 0 && state.filterAbsences === '' && state.filtersAbsences.processStatus === 'all' && state.filtersAbsences.pendingAction === 'all' && state.filtersAbsences.returnStatus === 'all') {
        dom.emptyStateAbsences.classList.remove('hidden');
        dom.absencesListDiv.innerHTML = '';
    } else {
        dom.emptyStateAbsences.classList.add('hidden');
        
        const sortedGroupKeys = filteredGroupKeys.sort((a, b) => {
            const lastActionA = groupedByProcess[a].sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0))[0];
            const lastActionB = groupedByProcess[b].sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0))[0];
            return (lastActionB.createdAt?.seconds || 0) - (lastActionA.createdAt?.seconds || 0);
        });

        let html = '';
        for (const processId of sortedGroupKeys) {
            const actions = groupedByProcess[processId].sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
            const firstAction = actions[0];
            const student = state.students.find(s => s.matricula === firstAction.studentId);
            if (!student) continue;

            const isConcluded = actions.some(a => a.actionType === 'analise');
            const hasCtAction = actions.some(a => a.actionType === 'encaminhamento_ct');

            html += `
                <div class="border rounded-lg overflow-hidden mb-4 bg-white shadow">
                    <div class="process-header bg-gray-50 hover:bg-gray-100 cursor-pointer p-4 flex justify-between items-center" data-process-id="${processId}">
                        <div>
                            <p class="font-semibold text-gray-800 cursor-pointer hover:underline new-action-from-history-btn" data-student-id="${student.matricula}">${student.name}</p>
                            <p class="text-sm text-gray-500">ID do Processo: ${processId} - Início: ${formatDate(firstAction.createdAt?.toDate())}</p>
                        </div>
                        <div class="flex items-center space-x-4">
                            ${isConcluded ? '<span class="text-xs font-bold text-white bg-green-600 px-2 py-1 rounded-full">CONCLUÍDO</span>' : ''}
                            <button class="generate-ficha-btn-row bg-purple-600 text-white font-bold py-1 px-3 rounded-lg shadow-md hover:bg-purple-700 text-xs no-print" data-student-id="${student.matricula}" data-process-id="${processId}">
                                <i class="fas fa-file-invoice"></i> Ficha
                            </button>
                            <i class="fas fa-chevron-down transition-transform duration-300"></i>
                        </div>
                    </div>
                    <div class="process-content" id="content-${processId}">
                        <div class="p-4 border-t border-gray-200">
                            <div class="space-y-4">
        `;
        
            actions.forEach(abs => {
                const actionDate = abs.contactDate || abs.visitDate || abs.ctSentDate || (abs.createdAt?.toDate() ? abs.createdAt.toDate().toISOString().split('T')[0] : '');
                const returned = abs.contactReturned === 'yes' || abs.visitReturned === 'yes' || abs.ctReturned === 'yes';
                const notReturned = abs.contactReturned === 'no' || abs.visitReturned === 'no' || abs.ctReturned === 'no';

                
                let actionButtonHtml = '';
                if (abs.actionType.startsWith('tentativa')) {
                    actionButtonHtml = `<button class="notification-btn text-indigo-600 hover:text-indigo-900 text-xs font-semibold py-1 px-2 rounded-md bg-indigo-50" data-id="${abs.id}" title="Gerar Notificação">Notificação</button>`;
                } else if (abs.actionType === 'visita') {
                    const disabled = isConcluded || hasCtAction;
                    actionButtonHtml = `<button class="send-ct-btn text-blue-600 hover:text-blue-900 text-xs font-semibold py-1 px-2 rounded-md bg-blue-50 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}" data-id="${abs.id}" title="${disabled ? 'Encaminhamento já realizado' : 'Enviar ao Conselho Tutelar'}" ${disabled ? 'disabled' : ''}>Enviar ao C.T.</button>`;
                } else if (abs.actionType === 'encaminhamento_ct') {
                     if(abs.oficioNumber) {
                          actionButtonHtml = `<button class="view-oficio-btn text-green-600 hover:text-green-900 text-xs font-semibold py-1 px-2 rounded-md bg-green-50" data-id="${abs.id}" title="Visualizar Ofício">Ver Ofício</button>`;
                     }
                } else {
                    actionButtonHtml = `<span class="inline-block w-24"></span>`;
                }
                
                let statusHtml = '';
                if (abs.actionType.startsWith('tentativa')) {
                    statusHtml = (abs.contactSucceeded === 'yes' || abs.contactSucceeded === 'no')
                        ? '<p class="text-xs text-green-600 font-semibold mt-1"><i class="fas fa-check"></i> Contato Realizado</p>'
                        : '<p class="text-xs text-yellow-600 font-semibold mt-1"><i class="fas fa-hourglass-half"></i> Aguardando Contato</p>';
                } else if (abs.actionType === 'visita') {
                     statusHtml = (abs.visitSucceeded === 'yes' || abs.visitSucceeded === 'no')
                        ? '<p class="text-xs text-green-600 font-semibold mt-1"><i class="fas fa-check"></i> Contato Realizado</p>'
                        : '<p class="text-xs text-yellow-600 font-semibold mt-1"><i class="fas fa-hourglass-half"></i> Aguardando Contato</p>';
                } else if (abs.actionType === 'encaminhamento_ct') {
                    statusHtml = abs.ctFeedback 
                        ? '<p class="text-xs text-green-600 font-semibold mt-1"><i class="fas fa-inbox"></i> Devolutiva Recebida</p>'
                        : '<p class="text-xs text-yellow-600 font-semibold mt-1"><i class="fas fa-hourglass-half"></i> Aguardando Devolutiva</p>';
                }

                // ATUALIZADO: (Item 6, 10) Botões de Ação de Busca Ativa
                html += `
                    <div class="flex justify-between items-start border-b last:border-b-0 pb-3">
                        <div>
                            <p class="font-medium text-gray-700">${actionDisplayTitles[abs.actionType] || 'N/A'}</p>
                            <p class="text-sm text-gray-500">Data: ${formatDate(actionDate)}</p>
                            ${returned ? '<p class="text-sm text-green-600 font-semibold mt-1"><i class="fas fa-check-circle"></i> Aluno Retornou</p>' : ''}
                            ${notReturned ? '<p class="text-sm text-red-600 font-semibold mt-1"><i class="fas fa-times-circle"></i> Aluno Não Retornou</p>' : ''}
                            ${statusHtml}
                        </div>
                        <div class="whitespace-nowrap text-right text-sm font-medium space-x-2 flex items-center">
                            ${actionButtonHtml}
                            
                            <div class="relative kebab-menu-container self-center">
                                <button class="kebab-menu-btn text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100" data-id="${abs.id}" title="Mais Opções">
                                    <i class="fas fa-ellipsis-v"></i>
                                </button>
                                <div class="kebab-menu-dropdown hidden absolute right-0 mt-1 w-40 bg-white rounded-md shadow-lg border z-10">
                                    <button class="kebab-action-btn menu-item w-full text-left" data-action="history" data-id="${abs.id}" data-process-id="${abs.processId}">
                                        <i class="fas fa-history mr-2 w-4"></i>Histórico
                                    </button>
                                    <button class="kebab-action-btn menu-item w-full text-left ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}" data-action="edit" data-id="${abs.id}" ${isConcluded ? 'disabled' : ''}>
                                        <i class="fas fa-pencil-alt mr-2 w-4"></i>Editar
                                    </button>
                                    <button class="kebab-action-btn menu-item menu-item-danger w-full text-left ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}" data-action="delete" data-id="${abs.id}" ${isConcluded ? 'disabled' : ''}>
                                        <i class="fas fa-trash mr-2 w-4"></i>Excluir
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });

            html += `</div></div></div></div>`;
        }
        dom.absencesListDiv.innerHTML = html;
    }
};


// =================================================================================
// SEÇÃO 3: FUNÇÕES DE RENDERIZAÇÃO PRINCIPAL E GERAIS
// =================================================================================

/**
 * ATUALIZADO (Problema 1): Lógica do menu "kebab" removida daqui.
 * Agora esta função apenas decide qual aba renderizar. A lógica de eventos
 * foi centralizada no `main.js` para evitar conflitos.
 */
export const render = () => {
    if (state.activeTab === 'occurrences') {
        renderOccurrences();
    } else {
        renderAbsences();
    }
};

/**
 * (Inalterado)
 * Abre um modal de seleção para o usuário escolher para qual aluno
 * de um incidente a notificação deve ser gerada.
 * @param {string} groupId - O ID do grupo da ocorrência.
 */
export const openStudentSelectionModal = (groupId) => {
    const incident = getFilteredOccurrences().get(groupId);
    if (!incident) return showToast('Incidente não encontrado.');

    const students = [...incident.studentsInvolved.values()];
    
    // Se houver apenas um aluno, gera a notificação diretamente sem perguntar.
    if (students.length === 1) {
        openIndividualNotificationModal(incident, students[0]);
        return;
    }
    
    const modal = document.getElementById('student-selection-modal'); 
    const modalBody = document.getElementById('student-selection-modal-body');
    
    if (!modal || !modalBody) {
        return showToast('Erro: O modal de seleção de aluno não foi encontrado na página.');
    }

    modalBody.innerHTML = ''; // Limpa o conteúdo anterior

    // Cria um botão para cada aluno envolvido.
    students.forEach(student => {
        const btn = document.createElement('button');
        btn.className = 'w-full text-left bg-gray-50 hover:bg-indigo-100 p-3 rounded-lg transition';
        btn.innerHTML = `<span class="font-semibold text-indigo-800">${student.name}</span><br><span class="text-sm text-gray-600">Turma: ${student.class}</span>`;
        btn.onclick = () => {
            openIndividualNotificationModal(incident, student);
            closeModal(modal);
        };
        modalBody.appendChild(btn);
    });

    openModal(modal);
}

/**
 * NOVO: (Item 5) Helper para gerar o cabeçalho com logo.
 * @returns {string} HTML do cabeçalho do relatório.
 */
const getReportHeaderHTML = () => {
    const logoUrl = state.config?.schoolLogoUrl || null;
    const schoolName = state.config?.schoolName || "Nome da Escola";

    if (logoUrl) {
        return `<div class="text-center mb-4"><img src="${logoUrl}" alt="Logo da Escola" class="max-w-full max-h-40 mx-auto"></div>`;
    }
    
    return `<div class="text-center border-b pb-4"><h2 class="text-xl font-bold uppercase">${schoolName}</h2></div>`;
};


/**
 * ATUALIZADO: (Item 1, 5) Gera e exibe a notificação para um único aluno selecionado.
 * Esta é agora uma convocação formal, sem detalhes da ocorrência.
 * @param {object} incident - O objeto completo do incidente.
 * @param {object} student - O objeto do aluno selecionado.
 */
export const openIndividualNotificationModal = (incident, student) => {
    const data = incident.records.find(r => r.studentId === student.matricula) || incident.records[0];
    const responsibleNames = [student.resp1, student.resp2].filter(Boolean).join(' e ');
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    document.getElementById('notification-title').innerText = 'Notificação de Ocorrência';
    document.getElementById('notification-content').innerHTML = `
        <div class="space-y-6 text-sm">
            ${getReportHeaderHTML()}
            <h3 class="text-lg font-semibold mt-4 text-center">NOTIFICAÇÃO DE OCORRÊNCIA ESCOLAR</h3>
            
            <p class="text-right mt-4">Data de Envio: ${currentDate}</p>

            <div class="pt-4">
                <p class="mb-2"><strong>Aos Responsáveis:</strong> ${formatText(responsibleNames)}</p>
                <p>Pelo(a) seguinte aluno(a):</p>
                <div class="mt-2 p-3 bg-gray-50 rounded border">
                    <p><strong>Aluno:</strong> ${formatText(student.name)}</p>
                    <p><strong>Turma:</strong> ${formatText(student.class)}</p>
                    <p><strong>Endereço:</strong> ${formatText(student.endereco)}</p>
                    <p><strong>Contato:</strong> ${formatText(student.contato)}</p>
                </div>
            </div>

            <p class="text-justify mt-4">
                Prezados(as), vimos por meio desta notificá-los sobre um registro referente ao(à) aluno(a) supracitado(a),
                classificado como <strong>"${formatText(data.occurrenceType)}"</strong>, ocorrido em ${formatDate(data.date)}.
            </p>
            
            <p class="text-justify bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                Conforme a legislação vigente, como a Lei de Diretrizes e Bases da Educação Nacional (LDB - Lei 9.394/96) e o
                Estatuto da Criança e do Adolescente (ECA - Lei 8.069/90), ressaltamos a importância da parceria e do
                acompanhamento ativo da família na vida escolar do(a) estudante, que é fundamental para seu desenvolvimento
                e para a manutenção de um ambiente escolar saudável.
            </p>
            
            ${data.meetingDate ? `
            <p class="mt-4 text-justify">
                Diante do exposto, solicitamos o comparecimento de um responsável na coordenação pedagógica para uma reunião
                na seguinte data e horário:
            </p>
            <div class="mt-4 p-3 bg-indigo-100 text-indigo-800 rounded-md text-center font-semibold">
                <p><strong>Data:</strong> ${formatDate(data.meetingDate)}</p>
                <p><strong>Horário:</strong> ${formatTime(data.meetingTime)}</p>
            </div>
            ` : `
            <p class="mt-4 text-justify">
                Diante do exposto, solicitamos o comparecimento de um responsável na coordenação pedagógica
                para tratarmos do assunto.
            </p>
            `}

            <div class="border-t pt-16 mt-16">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="text-center mt-1">Ciente do Responsável</p>
                </div>
            </div>
             <div class="border-t pt-16 mt-16">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="text-center mt-1">Assinatura da Gestão Escolar</p>
                </div>
            </div>
        </div>`;
    openModal(dom.notificationModalBackdrop);
};

/**
 * NOVO: (Item 4) Gera a Ata Formal da Ocorrência para impressão e arquivo.
 * @param {string} groupId - O ID do grupo da ocorrência.
 */
export const openOccurrenceRecordModal = (groupId) => {
    const incident = getFilteredOccurrences().get(groupId);
    if (!incident) return showToast('Incidente não encontrado.');
    
    const data = incident.records[0]; // Pega o registro principal
    const students = [...incident.studentsInvolved.values()];
    const studentNames = students.map(s => `${s.name} (Turma: ${s.class})`).join('<br>');
    const responsibleNames = [...new Set(students.flatMap(s => [s.resp1, s.resp2]).filter(Boolean))].join(' e ');

    document.getElementById('report-view-title').textContent = 'Ata de Registro de Ocorrência';
    document.getElementById('report-view-content').innerHTML = `
        <div class="space-y-6 text-sm">
            ${getReportHeaderHTML()}
            <h3 class="text-lg font-semibold mt-4 text-center uppercase">Ata de Registro de Ocorrência</h3>
            
            <p class="text-sm text-gray-500 text-right">ID do Incidente: ${incident.id}</p>

            <div class="border rounded-lg p-4 bg-gray-50 space-y-3">
                <div><h4 class="font-semibold">Data da Ocorrência:</h4><p>${formatDate(data.date)}</p></div>
                <div><h4 class="font-semibold">Tipo:</h4><p>${formatText(data.occurrenceType)}</p></div>
                <div><h4 class="font-semibold">Status:</h4><p>${formatText(data.status)}</p></div>
                <div><h4 class="font-semibold">Aluno(s) Envolvido(s):</h4><p>${studentNames}</p></div>
                <div><h4 class="font-semibold">Responsáveis:</h4><p>${formatText(responsibleNames)}</p></div>
            </div>

            <div class="border-t pt-4 space-y-4">
                <div><h4 class="font-semibold mb-1">Descrição Detalhada dos Fatos:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.description)}</p></div>
                <div><h4 class="font-semibold mb-1">Providências Tomadas pela Escola:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.actionsTakenSchool)}</p></div>
                
                ${(data.contactSucceeded || data.meetingDate) ? `
                <div class="border-t pt-4">
                    <h4 class="text-md font-semibold text-gray-700 mb-2">Registro de Contato e Convocação</h4>
                    ${data.meetingDate ? `<p><strong>Reunião Agendada:</strong> Data: ${formatDate(data.meetingDate)} | Horário: ${formatTime(data.meetingTime)}</p>` : ''}
                    ${data.contactSucceeded === 'yes' ? 
                        `<p><strong>Contato Realizado:</strong> Sim (Tipo: ${formatText(data.contactType)} em ${formatDate(data.contactDate)})</p>` : 
                        (data.contactSucceeded === 'no' ? '<p><strong>Contato Realizado:</strong> Não</p>' : '')
                    }
                </div>
                ` : ''}

                <div><h4 class="font-semibold mb-1">Providências Solicitadas à Família:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.actionsTakenFamily)}</p></div>
                ${data.parecer ? `<div><h4 class="font-semibold mb-1">Parecer/Desfecho:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.parecer)}</p></div>` : ''}
            </div>
            
            <div class="signature-block pt-16 mt-16 space-y-12">
                <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="text-center mt-1">Ciente do(s) Responsável(is)</p></div>
                <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="text-center mt-1">Ciente do(s) Aluno(s)</p></div>
                <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="text-center mt-1">Assinatura da Gestão Escolar</p></div>
            </div>
        </div>`;
    openModal(dom.reportViewModalBackdrop);
};


/**
 * (Inalterado)
 * Abre o modal de histórico de alterações de uma ocorrência.
 */
export const openHistoryModal = (groupId) => {
    const incident = getFilteredOccurrences().get(groupId);
    if (!incident) return showToast('Incidente não encontrado.');

    const mainRecord = incident.records[0];
    const history = [...(mainRecord.history || [])].sort((a, b) => (b.timestamp.seconds || new Date(b.timestamp).getTime()) - (a.timestamp.seconds || new Date(a.timestamp).getTime()));

    const historyHTML = history.length > 0
        ? history.map(entry => {
            const timestamp = entry.timestamp.seconds ? new Date(entry.timestamp.seconds * 1000) : new Date(entry.timestamp);
            return `<div class="flex items-start space-x-4 py-3"><div class="flex-shrink-0"><div class="bg-gray-200 rounded-full h-8 w-8 flex items-center justify-center"><i class="fas fa-history text-gray-500"></i></div></div><div><p class="text-sm font-semibold text-gray-800">${entry.action}</p><p class="text-xs text-gray-500">Por: ${entry.user || 'Sistema'} em ${timestamp.toLocaleDateString('pt-BR')} às ${timestamp.toLocaleTimeString('pt-BR')}</p></div></div>`;
        }).join('')
        : '<p class="text-sm text-gray-500 text-center py-4">Nenhum histórico de alterações para este incidente.</p>';
    
    document.getElementById('history-view-title').textContent = `Histórico do Incidente`;
    document.getElementById('history-view-subtitle').innerHTML = `<strong>ID:</strong> ${groupId}<br><strong>Data:</strong> ${formatDate(mainRecord.date)}`;
    document.getElementById('history-view-content').innerHTML = `<div class="divide-y divide-gray-200">${historyHTML}</div>`;
    openModal(document.getElementById('history-view-modal-backdrop'));
};

/**
 * NOVO: (Item 6) Abre o modal de histórico de alterações de uma ação de Busca Ativa.
 */
export const openAbsenceHistoryModal = (processId) => {
    const processActions = state.absences.filter(a => a.processId === processId);
    if (processActions.length === 0) return showToast('Processo não encontrado.');
    
    // Agrega o histórico de todas as ações do processo
    const allHistory = processActions.flatMap(a => a.history || []);
    
    // Adiciona a criação da ação como um evento de histórico, caso o array 'history' não exista
    processActions.forEach(action => {
        if (!action.history || action.history.length === 0) {
            allHistory.push({
                action: `Ação "${actionDisplayTitles[action.actionType]}" criada.`,
                user: action.createdBy || 'Sistema',
                timestamp: action.createdAt?.toDate() || new Date()
            });
        }
    });

    const history = allHistory.sort((a, b) => (b.timestamp.seconds || new Date(b.timestamp).getTime()) - (a.timestamp.seconds || new Date(a.timestamp).getTime()));

    const historyHTML = history.length > 0
        ? history.map(entry => {
            const timestamp = entry.timestamp.seconds ? new Date(entry.timestamp.seconds * 1000) : new Date(entry.timestamp);
            return `<div class="flex items-start space-x-4 py-3"><div class="flex-shrink-0"><div class="bg-gray-200 rounded-full h-8 w-8 flex items-center justify-center"><i class="fas fa-history text-gray-500"></i></div></div><div><p class="text-sm font-semibold text-gray-800">${entry.action}</p><p class="text-xs text-gray-500">Por: ${entry.user || 'Sistema'} em ${timestamp.toLocaleDateString('pt-BR')} às ${timestamp.toLocaleTimeString('pt-BR')}</p></div></div>`;
        }).join('')
        : '<p class="text-sm text-gray-500 text-center py-4">Nenhum histórico de alterações para este processo.</p>';

    document.getElementById('history-view-title').textContent = `Histórico do Processo`;
    document.getElementById('history-view-subtitle').innerHTML = `<strong>ID:</strong> ${processId}`;
    document.getElementById('history-view-content').innerHTML = `<div class="divide-y divide-gray-200">${historyHTML}</div>`;
    openModal(document.getElementById('history-view-modal-backdrop'));
};


/**
 * (Inalterado)
 * Configura o autocomplete para as barras de busca principais.
 */
export const setupAutocomplete = (inputId, suggestionsId, onSelectCallback) => {
    const input = document.getElementById(inputId);
    const suggestionsContainer = document.getElementById(suggestionsId);
    
    input.addEventListener('input', () => {
        const value = input.value.toLowerCase();
        
        if (inputId === 'search-absences') {
            state.filterAbsences = value;
            render();
        }
        
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
                    if (onSelectCallback) onSelectCallback(student);
                    input.value = '';
                    if (inputId === 'search-absences') state.filterAbsences = '';
                    render();
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

/**
 * (Inalterado)
 * Renderiza a lista de alunos no modal de gerenciamento.
 */
export const renderStudentsList = () => {
    const tableBody = document.getElementById('students-list-table');
    tableBody.innerHTML = '';
    state.students.sort((a,b) => a.name.localeCompare(b.name)).forEach(student => {
        const row = document.createElement('tr');
        row.innerHTML = `<td class="px-4 py-2 text-sm text-gray-900">${student.name}</td><td class="px-4 py-2 text-sm text-gray-500">${student.class}</td><td class="px-4 py-2 text-right text-sm space-x-2"><button class="edit-student-btn text-yellow-600 hover:text-yellow-900" data-id="${student.matricula}"><i class="fas fa-pencil-alt"></i></button><button class="delete-student-btn text-red-600 hover:text-red-900" data-id="${student.matricula}"><i class="fas fa-trash"></i></button></td>`;
        tableBody.appendChild(row);
    });
    
    document.querySelectorAll('.edit-student-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const student = state.students.find(s => s.matricula === id);
            if (student) {
                document.getElementById('student-form-title').textContent = 'Editar Aluno';
                document.getElementById('student-id-input').value = student.matricula;
                document.getElementById('student-matricula-input').value = student.matricula;
                document.getElementById('student-matricula-input').readOnly = true;
                document.getElementById('student-matricula-input').classList.add('bg-gray-100');
                document.getElementById('student-name-input').value = student.name;
                document.getElementById('student-class-input').value = student.class;
                document.getElementById('student-endereco-input').value = student.endereco || '';
                document.getElementById('student-contato-input').value = student.contato || '';
                document.getElementById('student-resp1-input').value = student.resp1;
                document.getElementById('student-resp2-input').value = student.resp2;
                document.getElementById('cancel-edit-student-btn').classList.remove('hidden');
            }
        });
    });

    document.querySelectorAll('.delete-student-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            const student = state.students.find(s => s.matricula === id);
            if (student && confirm(`Tem a certeza que quer remover o aluno "${student.name}"?`)) {
                const updatedList = state.students.filter(s => s.matricula !== id);
                try {
                    await setDoc(getStudentsDocRef(), { list: updatedList });
                    state.students = updatedList;
                    renderStudentsList();
                    showToast("Aluno removido com sucesso.");
                } catch(error) {
                    console.error("Erro ao remover aluno:", error);
                    showToast("Erro ao remover aluno.");
                }
            }
        });
    });
};

/**
 * (Inalterado)
 * Reseta o formulário de adição/edição de aluno.
 */
export const resetStudentForm = () => {
    document.getElementById('student-form-title').textContent = 'Adicionar Novo Aluno';
    document.getElementById('student-form').reset();
    document.getElementById('student-id-input').value = '';
    document.getElementById('student-matricula-input').readOnly = false;
    document.getElementById('student-matricula-input').classList.remove('bg-gray-100');
    document.getElementById('cancel-edit-student-btn').classList.add('hidden');
};

/**
 * (Inalterado)
 * Funções de exibição das telas de login/registro.
 */
export const showLoginView = () => {
    dom.registerView.classList.add('hidden');
    dom.loginView.classList.remove('hidden');
};

export const showRegisterView = () => {
    dom.loginView.classList.add('hidden');
    dom.registerView.classList.remove('hidden');
};


/**
 * ATUALIZADO (Problema 2): A classe `no-print` foi removida do container dos gráficos.
 * Isso permite que os gráficos sejam renderizados ao imprimir a página.
 * A classe `no-print` ainda é usada em botões e outros elementos que não devem aparecer.
 */
export const generateAndShowGeneralReport = () => {
    const filteredIncidents = getFilteredOccurrences();
    if (filteredIncidents.size === 0) {
        return showToast('Nenhum incidente encontrado para os filtros selecionados.');
    }

    const { startDate, endDate, status, type } = state.filtersOccurrences;
    const studentFilter = state.filterOccurrences;
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const allRecords = [...filteredIncidents.values()].flatMap(i => i.records);
    const totalStudents = new Set([...filteredIncidents.values()].flatMap(i => [...i.studentsInvolved.keys()])).size;
    
    // Dados para Gráficos (Item 7)
    const occurrencesByType = allRecords.reduce((acc, occ) => {
        const occType = occ.occurrenceType || 'Não especificado';
        acc[occType] = (acc[occType] || 0) + 1;
        return acc;
    }, {});
    const sortedTypes = Object.entries(occurrencesByType).sort((a, b) => b[1] - a[1]);

    const occurrencesByStatus = allRecords.reduce((acc, occ) => {
        const occStatus = occ.status || 'Pendente';
        acc[occStatus] = (acc[occStatus] || 0) + 1;
        return acc;
    }, {});
    
    // Prepara dados para Chart.js
    const chartDataByType = {
        labels: sortedTypes.map(item => item[0]),
        data: sortedTypes.map(item => item[1])
    };
    const chartDataByStatus = {
        labels: Object.keys(occurrencesByStatus),
        data: Object.values(occurrencesByStatus)
    };


    const reportHTML = `
        <div class="space-y-8 text-sm font-sans">
            ${getReportHeaderHTML()}
            <h3 class="text-xl font-semibold text-gray-700 mt-2 text-center">Relatório Geral de Ocorrências</h3>
            <p class="text-gray-500 mt-1 text-center">Gerado em: ${currentDate}</p>
            
            <div class="border rounded-lg p-4 bg-gray-50">
                <h4 class="font-semibold text-base mb-3 text-gray-700 border-b pb-2">Resumo do Período</h4>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                    <div><p class="text-2xl font-bold text-indigo-600">${filteredIncidents.size}</p><p class="text-xs font-medium text-gray-500 uppercase">Total de Incidentes</p></div>
                    <div><p class="text-2xl font-bold text-indigo-600">${totalStudents}</p><p class="text-xs font-medium text-gray-500 uppercase">Alunos Envolvidos</p></div>
                    <div><p class="text-lg font-bold text-indigo-600">${sortedTypes.length > 0 ? sortedTypes[0][0] : 'N/A'}</p><p class="text-xs font-medium text-gray-500 uppercase">Principal Tipo</p></div>
                </div>
                ${(startDate || endDate || status !== 'all' || type !== 'all' || studentFilter) ? `<div class="mt-4 border-t pt-3 text-xs text-gray-600"><p><strong>Filtros Aplicados:</strong></p><ul class="list-disc list-inside ml-2">${startDate ? `<li>De: <strong>${formatDate(startDate)}</strong></li>` : ''}${endDate ? `<li>Até: <strong>${formatDate(endDate)}</strong></li>` : ''}${status !== 'all' ? `<li>Status: <strong>${status}</strong></li>` : ''}${type !== 'all' ? `<li>Tipo: <strong>${type}</strong></li>` : ''}${studentFilter ? `<li>Aluno: <strong>"${formatText(studentFilter)}"</strong></li>` : ''}</ul></div>` : ''}
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="border rounded-lg p-4 shadow-sm bg-white">
                    <h5 class="font-semibold text-center mb-2">Ocorrências por Tipo</h5>
                    <canvas id="report-chart-by-type" data-labels='${JSON.stringify(chartDataByType.labels)}' data-data='${JSON.stringify(chartDataByType.data)}'></canvas>
                </div>
                <div class="border rounded-lg p-4 shadow-sm bg-white">
                    <h5 class="font-semibold text-center mb-2">Ocorrências por Status</h5>
                    <canvas id="report-chart-by-status" data-labels='${JSON.stringify(chartDataByStatus.labels)}' data-data='${JSON.stringify(chartDataByStatus.data)}'></canvas>
                </div>
            </div>

            <div>
                <h4 class="font-semibold text-base mb-3 text-gray-700 border-b pb-2">Detalhes dos Incidentes</h4>
                <div class="space-y-6">
                ${[...filteredIncidents.values()].sort((a,b) => new Date(b.records[0].date) - new Date(a.records[0].date)).map(incident => {
                    const mainRecord = incident.records[0];
                    const studentNames = [...incident.studentsInvolved.values()].map(s => s.name).join(', ');
                    return `
                    <div class="border rounded-lg overflow-hidden break-inside-avoid">
                        <div class="bg-gray-100 p-3 flex justify-between items-center">
                            <div>
                                <p class="font-bold text-gray-800">${mainRecord.occurrenceType}</p>
                                <p class="text-xs text-gray-600">Data: ${formatDate(mainRecord.date)} | ID: ${incident.id}</p>
                            </div>
                            ${getStatusBadge(mainRecord.status)}
                        </div>
                        <div class="p-4 space-y-3">
                            <p><strong>Alunos Envolvidos:</strong> ${studentNames}</p>
                            <div><h5 class="text-xs font-semibold uppercase text-gray-500">Descrição</h5><p class="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded">${formatText(mainRecord.description)}</p></div>
                            <div><h5 class="text-xs font-semibold uppercase text-gray-500">Providências da Escola</h5><p class="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded">${formatText(mainRecord.actionsTakenSchool)}</p></div>
                            <div><h5 class="text-xs font-semibold uppercase text-gray-500">Providências da Família</h5><p class="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded">${formatText(mainRecord.actionsTakenFamily)}</p></div>
                            ${mainRecord.parecer ? `<div><h5 class="text-xs font-semibold uppercase text-gray-500">Parecer/Desfecho</h5><p class="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded">${formatText(mainRecord.parecer)}</p></div>` : ''}
                        </div>
                    </div>`;
                }).join('')}
                </div>
            </div>
            
            <div class="signature-block pt-16 mt-8"><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1 text-sm">Assinatura da Gestão Escolar</p></div></div>
        </div>
    `;

    document.getElementById('report-view-title').textContent = "Relatório Geral de Ocorrências";
    document.getElementById('report-view-content').innerHTML = reportHTML;
    openModal(dom.reportViewModalBackdrop);

    // ATENÇÃO: É preciso carregar a biblioteca Chart.js no index.html para isto funcionar
    try {
        const typeCtx = document.getElementById('report-chart-by-type').getContext('2d');
        new Chart(typeCtx, {
            type: 'bar',
            data: { labels: chartDataByType.labels, datasets: [{ label: 'Total', data: chartDataByType.data, backgroundColor: '#4f46e5' }] },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });

        const statusCtx = document.getElementById('report-chart-by-status').getContext('2d');
        new Chart(statusCtx, {
            type: 'doughnut',
            data: { labels: chartDataByStatus.labels, datasets: [{ data: chartDataByStatus.data, backgroundColor: ['#f59e0b', '#10b981', '#6b7280'] }] },
            options: { responsive: true }
        });
    } catch (e) {
        console.warn("Chart.js não está carregado. Gráficos não serão exibidos.");
        document.getElementById('report-chart-by-type').parentElement.innerHTML = "<p class='text-center text-red-500 text-xs'>Chart.js não foi carregado. Gráficos indisponíveis.</p>";
        document.getElementById('report-chart-by-status').parentElement.innerHTML = "";
    }
};

/**
 * ATUALIZADO (Problema 2): A classe `no-print` foi removida do container dos gráficos.
 */
export const generateAndShowBuscaAtivaReport = () => {
    // 1. Agrupa todas as ações por 'processId'
    const groupedByProcess = state.absences.reduce((acc, action) => {
        const key = action.processId || `no-proc-${action.id}`;
        if (!acc[key]) acc[key] = { id: key, actions: [], studentId: action.studentId };
        acc[key].actions.push(action);
        return acc;
    }, {});

    const processes = Object.values(groupedByProcess);
    if (processes.length === 0) {
        return showToast('Nenhum processo de Busca Ativa encontrado.');
    }

    const { processStatus, pendingAction, returnStatus } = state.filtersAbsences;
    const studentFilter = state.filterAbsences;
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    let statusConcluido = 0, statusEmAndamento = 0;
    let retornoSim = 0, retornoNao = 0, retornoPendente = 0;
    let pendenteContato = 0, pendenteDevolutiva = 0;

    const filteredProcesses = processes.filter(proc => {
        proc.actions.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
        const lastAction = proc.actions[proc.actions.length - 1];
        const student = state.students.find(s => s.matricula === proc.studentId);
        
        // Filtro de Aluno
        if (studentFilter && (!student || !student.name.toLowerCase().includes(studentFilter.toLowerCase()))) return false;
        
        // Status do Processo
        const isConcluded = proc.actions.some(a => a.actionType === 'analise');
        if (processStatus === 'in_progress' && isConcluded) return false;
        if (processStatus === 'concluded' && !isConcluded) return false;

        // Status de Retorno
        const lastReturnAction = [...proc.actions].reverse().find(a => a.contactReturned || a.visitReturned || a.ctReturned);
        const lastReturnStatus = lastReturnAction ? (lastReturnAction.contactReturned || lastReturnAction.visitReturned || lastReturnAction.ctReturned) : 'pending';
        
        if (returnStatus === 'returned' && lastReturnStatus !== 'yes') return false;
        if (returnStatus === 'not_returned' && lastReturnStatus !== 'no') return false;
        if (returnStatus === 'pending' && lastReturnStatus !== 'pending') return false;

        // Ações Pendentes (só conta se não estiver concluído)
        let isPendingContact = false, isPendingFeedback = false;
        if (!isConcluded) {
            isPendingContact = (lastAction.actionType.startsWith('tentativa') && lastAction.contactSucceeded == null) || (lastAction.actionType === 'visita' && lastAction.visitSucceeded == null);
            
            const ctAction = proc.actions.find(a => a.actionType === 'encaminhamento_ct');
            isPendingFeedback = ctAction && !ctAction.ctFeedback;
        }

        if (pendingAction === 'pending_contact' && !isPendingContact) return false;
        if (pendingAction === 'pending_feedback' && !isPendingFeedback) return false;
        
        // Contadores para Gráficos (contabiliza apenas os filtrados)
        isConcluded ? statusConcluido++ : statusEmAndamento++;
        if (lastReturnStatus === 'yes') retornoSim++;
        else if (lastReturnStatus === 'no') retornoNao++;
        else retornoPendente++;
        
        if (isPendingContact) pendenteContato++;
        if (isPendingFeedback) pendenteDevolutiva++;

        return true;
    });

    if (filteredProcesses.length === 0) {
        return showToast('Nenhum processo encontrado para os filtros selecionados.');
    }

    // Prepara dados para Chart.js
    const chartDataStatus = { labels: ['Em Andamento', 'Concluídos'], data: [statusEmAndamento, statusConcluido] };
    const chartDataRetorno = { labels: ['Retornou', 'Não Retornou', 'Pendente'], data: [retornoSim, retornoNao, retornoPendente] };
    const chartDataPendente = { labels: ['Aguard. Contato', 'Aguard. Devolutiva CT'], data: [pendenteContato, pendenteDevolutiva] };

    const reportHTML = `
        <div class="space-y-8 text-sm font-sans">
            ${getReportHeaderHTML()}
            <h3 class="text-xl font-semibold text-gray-700 mt-2 text-center">Relatório Geral de Busca Ativa</h3>
            <p class="text-gray-500 mt-1 text-center">Gerado em: ${currentDate}</p>

            <div class="border rounded-lg p-4 bg-gray-50">
                <h4 class="font-semibold text-base mb-3 text-gray-700 border-b pb-2">Resumo do Período</h4>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                    <div><p class="text-2xl font-bold text-indigo-600">${filteredProcesses.length}</p><p class="text-xs font-medium text-gray-500 uppercase">Processos Filtrados</p></div>
                    <div><p class="text-2xl font-bold text-indigo-600">${statusEmAndamento}</p><p class="text-xs font-medium text-gray-500 uppercase">Em Andamento</p></div>
                    <div><p class="text-2xl font-bold text-indigo-600">${retornoSim}</p><p class="text-xs font-medium text-gray-500 uppercase">Alunos Retornaram</p></div>
                </div>
                </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="border rounded-lg p-4 shadow-sm bg-white"><h5 class="font-semibold text-center mb-2">Status dos Processos</h5><canvas id="ba-chart-status"></canvas></div>
                <div class="border rounded-lg p-4 shadow-sm bg-white"><h5 class="font-semibold text-center mb-2">Status de Retorno</h5><canvas id="ba-chart-retorno"></canvas></div>
                <div class="border rounded-lg p-4 shadow-sm bg-white"><h5 class="font-semibold text-center mb-2">Ações Pendentes (Em Andamento)</h5><canvas id="ba-chart-pendente"></canvas></div>
            </div>

            <div>
                <h4 class="font-semibold text-base mb-3 text-gray-700 border-b pb-2">Detalhes dos Processos</h4>
                <div class="space-y-4">
                ${filteredProcesses.sort((a,b) => (b.actions[b.actions.length-1].createdAt?.seconds || 0) - (a.actions[a.actions.length-1].createdAt?.seconds || 0)).map(proc => {
                    const student = state.students.find(s => s.matricula === proc.studentId);
                    const lastAction = proc.actions[proc.actions.length - 1];
                    const isConcluded = lastAction.actionType === 'analise';
                    return `
                    <div class="border rounded-lg overflow-hidden break-inside-avoid">
                        <div class="bg-gray-100 p-3 flex justify-between items-center">
                            <div>
                                <p class="font-bold text-gray-800">${student ? student.name : 'Aluno Removido'}</p>
                                <p class="text-xs text-gray-600">Turma: ${student ? student.class : 'N/A'} | ID: ${proc.id}</p>
                            </div>
                            ${isConcluded ? '<span class="text-xs font-bold text-white bg-green-600 px-2 py-1 rounded-full">CONCLUÍDO</span>' : '<span class="text-xs font-bold text-white bg-yellow-600 px-2 py-1 rounded-full">EM ANDAMENTO</span>'}
                        </div>
                        <div class="p-4">
                            <h5 class="text-xs font-semibold uppercase text-gray-500 mb-2">Resumo das Ações (${proc.actions.length})</h5>
                            <ul class="list-disc list-inside text-xs space-y-1">
                                ${proc.actions.map(a => `<li><strong>${actionDisplayTitles[a.actionType]}</strong> (em ${formatDate(a.createdAt?.toDate())})</li>`).join('')}
                            </ul>
                            ${isConcluded ? `<div class="mt-3 border-t pt-2"><h5 class="text-xs font-semibold uppercase text-gray-500">Parecer Final</h5><p class="text-xs whitespace-pre-wrap">${formatText(lastAction.ctParecer)}</p></div>` : ''}
                        </div>
                    </div>`;
                }).join('')}
                </div>
            </div>
            
            <div class="signature-block pt-16 mt-8"><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1 text-sm">Assinatura da Gestão Escolar</p></div></div>
        </div>
    `;

    document.getElementById('report-view-title').textContent = "Relatório Geral de Busca Ativa";
    document.getElementById('report-view-content').innerHTML = reportHTML;
    openModal(dom.reportViewModalBackdrop);

    try {
        new Chart(document.getElementById('ba-chart-status').getContext('2d'), {
            type: 'doughnut',
            data: { labels: chartDataStatus.labels, datasets: [{ data: chartDataStatus.data, backgroundColor: ['#f59e0b', '#10b981'] }] },
            options: { responsive: true }
        });
        new Chart(document.getElementById('ba-chart-retorno').getContext('2d'), {
            type: 'pie',
            data: { labels: chartDataRetorno.labels, datasets: [{ data: chartDataRetorno.data, backgroundColor: ['#10b981', '#ef4444', '#6b7280'] }] },
            options: { responsive: true }
        });
         new Chart(document.getElementById('ba-chart-pendente').getContext('2d'), {
            type: 'bar',
            data: { labels: chartDataPendente.labels, datasets: [{ label: 'Total', data: chartDataPendente.data, backgroundColor: ['#3b82f6', '#f97316'] }] },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });
    } catch (e) {
        console.warn("Chart.js não está carregado. Gráficos não serão exibidos.");
    }
};


/**
 * ATUALIZADO: (Item 5) Adiciona logo ao modal de ficha.
 */
export const openFichaViewModal = (id) => {
    const record = state.absences.find(abs => abs.id === id);
    if (!record) return showToast('Registro não encontrado.');
    const student = state.students.find(s => s.matricula === record.studentId) || {name: 'Aluno Removido', class: 'N/A', endereco: '', resp1: '', resp2: '', contato: ''};
    
    const attemptLabels = { tentativa_1: "primeira", tentativa_2: "segunda", tentativa_3: "terceira" };
    let title = "Notificação de Baixa Frequência";
    
    let body = '';
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ');

    switch (record.actionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            body = `
                <p class="mt-4 text-justify">Prezados(as) Responsáveis, <strong>${responsaveis}</strong>,</p>
                <p class="mt-4 text-justify">
                    Vimos por meio desta notificar que o(a) estudante supracitado(a) acumulou <strong>${formatText(record.absenceCount)} faltas</strong> no período ${formatPeriodo(record.periodoFaltasStart, record.periodoFaltasEnd)}, 
                    configurando baixa frequência escolar. Esta é a <strong>${attemptLabels[record.actionType]} tentativa de contato</strong> realizada pela escola.
                </p>
                <p class="mt-4 text-justify bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
                    Ressaltamos que, conforme a Lei de Diretrizes e Bases da Educação Nacional (LDB - Lei 9.394/96) e o Estatuto da Criança e do Adolescente (ECA - Lei 8.069/90), 
                    é dever da família zelar pela frequência do(a) estudante à escola. A persistência das faltas implicará no acionamento do Conselho Tutelar para as devidas providências.
                </p>
                <p class="mt-4 text-justify">
                    Diante do exposto, solicitamos o comparecimento de um(a) responsável na <strong>coordenação pedagógica</strong> desta unidade escolar para tratarmos do assunto na data e horário abaixo:
                </p>
                <div class="mt-4 p-3 bg-gray-100 rounded-md text-center">
                    <p><strong>Data:</strong> ${formatDate(record.meetingDate)}</p>
                    <p><strong>Horário:</strong> ${formatTime(record.meetingTime)}</p>
                </div>
            `;
            break;
        case 'visita':
            title = actionDisplayTitles[record.actionType];
            body = `<p class="mt-4">Notificamos que na data de <strong>${formatDate(record.visitDate)}</strong>, o agente escolar <strong>${formatText(record.visitAgent)}</strong> realizou uma visita domiciliar.</p><p class="mt-2"><strong>Justificativa do responsável:</strong> ${formatText(record.visitReason)}</p>`;
            break;
        default: 
            title = actionDisplayTitles[record.actionType] || 'Documento de Busca Ativa';
            body = `<p class="mt-4">Registro de ação administrativa referente à busca ativa do(a) aluno(a).</p>`; 
            break;
    }

    const contentHTML = `
        <div class="space-y-6 text-sm text-gray-800">
            ${getReportHeaderHTML()}
            <h3 class="font-semibold mt-1 uppercase text-center">${title}</h3>

            <div class="pt-4 border-t mt-4">
                <p><strong>Aluno(a):</strong> ${student.name}</p>
                <p><strong>Turma:</strong> ${student.class || ''}</p>
                <p><strong>Endereço:</strong> ${formatText(student.endereco)}</p>
                <p><strong>Contato:</strong> ${formatText(student.contato)}</p>
            </div>
            <div class="text-justify">${body}</div>
            <div class="border-t pt-16 mt-16">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="text-center mt-1">Ciente do Responsável</p>
                </div>
            </div>
        </div>`;

    document.getElementById('ficha-view-title').textContent = title;
    document.getElementById('ficha-view-content').innerHTML = contentHTML;
    openModal(dom.fichaViewModalBackdrop);
};

/**
 * ATUALIZADO: (Item 5) Adiciona logo à ficha consolidada.
 */
export const generateAndShowConsolidatedFicha = (studentId, processId = null) => {
    let studentActions = state.absences.filter(action => action.studentId === studentId);
    
    if (processId) {
        studentActions = studentActions.filter(action => action.processId === processId);
    }

    studentActions.sort((a, b) => (a.createdAt?.toDate() || 0) - (b.createdAt?.toDate() || 0));

    if (studentActions.length === 0) return showToast('Nenhuma ação para este aluno neste processo.');
    const studentData = state.students.find(s => s.matricula === studentId);

    const findAction = (type) => studentActions.find(a => a.actionType === type) || {};
    const t1 = findAction('tentativa_1'), t2 = findAction('tentativa_2'), t3 = findAction('tentativa_3'), visita = findAction('visita'), ct = findAction('encaminhamento_ct'), analise = findAction('analise');
    
    const faltasData = t1.periodoFaltasStart ? t1 : (t2.periodoFaltasStart ? t2 : (t3.periodoFaltasStart ? t3 : (visita.periodoFaltasStart ? visita : {})));

    const fichaHTML = `
        <div class="space-y-4 text-sm">
            ${getReportHeaderHTML()}
            <h3 class="font-semibold mt-1 text-center">Ficha de Acompanhamento da Busca Ativa</h3>
            
            <div class="border rounded-md p-3">
                <h4 class="font-semibold text-base mb-2">Identificação</h4>
                <p><strong>Nome do aluno:</strong> ${studentData.name}</p>
                <p><strong>Ano/Ciclo:</strong> ${studentData.class || ''}</p>
                <p><strong>Endereço:</strong> ${formatText(studentData.endereco)}</p>
                <p><strong>Contato:</strong> ${formatText(studentData.contato)}</p>
            </div>

            <div class="border rounded-md p-3">
                <h4 class="font-semibold text-base mb-2">Faltas apuradas no período de:</h4>
                <p><strong>Data de início:</strong> ${formatDate(faltasData.periodoFaltasStart)}</p>
                <p><strong>Data de fim:</strong> ${formatDate(faltasData.periodoFaltasEnd)}</p>
                <p><strong>Nº de faltas:</strong> ${formatText(faltasData.absenceCount)}</p>
            </div>

            <div class="border rounded-md p-3 space-y-3">
                <h4 class="font-semibold text-base">Tentativas de contato com o responsável pelo estudante (ligações, whatsApp ou carta ao responsável)</h4>
                <div class="pl-4">
                    <p class="font-medium underline">1ª Tentativa:</p>
                    <p><strong>Conseguiu contato?</strong> ${t1.contactSucceeded === 'yes' ? 'Sim' : t1.contactSucceeded === 'no' ? 'Não' : ''}</p>
                    <p><strong>Tipo de Contato:</strong> ${formatText(t1.contactType)}</p>
                    <p><strong>Dia do contato:</strong> ${formatDate(t1.contactDate)}</p>
                    <p><strong>Com quem falou?</strong> ${formatText(t1.contactPerson)}</p>
                    <p><strong>Justificativa:</strong> ${formatText(t1.contactReason)}</p>
                    <p><strong>Aluno retornou?</strong> ${t1.contactReturned === 'yes' ? 'Sim' : t1.contactReturned === 'no' ? 'Não' : ''}</p>
                </div>
                <div class="pl-4 border-t pt-2">
                    <p class="font-medium underline">2ª Tentativa:</p>
                    <p><strong>Conseguiu contato?</strong> ${t2.contactSucceeded === 'yes' ? 'Sim' : t2.contactSucceeded === 'no' ? 'Não' : ''}</p>
                    <p><strong>Tipo de Contato:</strong> ${formatText(t2.contactType)}</p>
                    <p><strong>Dia do contato:</strong> ${formatDate(t2.contactDate)}</p>
                    <p><strong>Com quem falou?</strong> ${formatText(t2.contactPerson)}</p>
                    <p><strong>Justificativa:</strong> ${formatText(t2.contactReason)}</p>
                    <p><strong>Aluno retornou?</strong> ${t2.contactReturned === 'yes' ? 'Sim' : t2.contactReturned === 'no' ? 'Não' : ''}</p>
                </div>
                <div class="pl-4 border-t pt-2">
                    <p class="font-medium underline">3ª Tentativa:</p>
                    <p><strong>Conseguiu contato?</strong> ${t3.contactSucceeded === 'yes' ? 'Sim' : t3.contactSucceeded === 'no' ? 'Não' : ''}</p>
                    <p><strong>Tipo de Contato:</strong> ${formatText(t3.contactType)}</p>
                    <p><strong>Dia do contato:</strong> ${formatDate(t3.contactDate)}</p>
                    <p><strong>Com quem falou?</strong> ${formatText(t3.contactPerson)}</p>
                    <p><strong>Justificativa:</strong> ${formatText(t3.contactReason)}</p>
                    <p><strong>Aluno retornou?</strong> ${t3.contactReturned === 'yes' ? 'Sim' : t3.contactReturned === 'no' ? 'Não' : ''}</p>
                </div>
            </div>

            <div class="border rounded-md p-3 space-y-2">
                <h4 class="font-semibold text-base">Contato in loco/Conversa com o responsável</h4>
                <p><strong>Nome do agente que realizou a visita:</strong> ${formatText(visita.visitAgent)}</p>
                <p><strong>Dia da visita:</strong> ${formatDate(visita.visitDate)}</p>
                <p><strong>Conseguiu contato?</strong> ${visita.visitSucceeded === 'yes' ? 'Sim' : visita.visitSucceeded === 'no' ? 'Não' : ''}</p>
                <p><strong>Com quem falou?</strong> ${formatText(visita.visitContactPerson)}</p>
                <p><strong>Justificativa:</strong> ${formatText(visita.visitReason)}</p>
                <p><strong>Aluno retornou?</strong> ${visita.visitReturned === 'yes' ? 'Sim' : visita.visitReturned === 'no' ? 'Não' : ''}</p>
                <p><strong>Observação:</strong> ${formatText(visita.visitObs)}</p>
            </div>

            <div class="border rounded-md p-3 space-y-2">
                <h4 class="font-semibold text-base">Encaminhamento ao Conselho Tutelar</h4>
                <p><strong>Data de envio:</strong> ${formatDate(ct.ctSentDate)}</p>
                <p><strong>Devolutiva:</strong> ${formatText(ct.ctFeedback)}</p>
                <p><strong>Aluno retornou?</strong> ${ct.ctReturned === 'yes' ? 'Sim' : ct.ctReturned === 'no' ? 'Não' : ''}</p>
            </div>

            <div class="border rounded-md p-3 space-y-2">
                <h4 class="font-semibold text-base">Análise</h4>
                <p><strong>Parecer da BAE:</strong> ${formatText(analise.ctParecer)}</p>
            </div>
            
            <div class="signature-block pt-16 mt-8 space-y-12">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="mt-1">Diretor(a)</p>
                </div>
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="mt-1">Coordenador(a) Pedagógico(a)</p>
                </div>
            </div>
        </div>`;
    document.getElementById('report-view-title').textContent = "Ficha Consolidada de Busca Ativa";
    document.getElementById('report-view-content').innerHTML = fichaHTML;
    openModal(dom.reportViewModalBackdrop);
};

/**
 * ATUALIZADO: (Item 5) Adiciona logo ao ofício.
 */
export const generateAndShowOficio = (action, oficioNumber = null) => {
    if (!action) return showToast('Ação de origem não encontrada.');
    
    const finalOficioNumber = oficioNumber || action.oficioNumber;
    const finalOficioYear = action.oficioYear || new Date().getFullYear();

    if (!finalOficioNumber) return showToast('Número do ofício não encontrado para este registro.');

    const student = state.students.find(s => s.matricula === action.studentId);
    if (!student) return showToast('Aluno não encontrado.');

    const processActions = state.absences
        .filter(a => a.processId === action.processId)
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

    if (processActions.length === 0) return showToast('Nenhuma ação encontrada para este processo.');

    const firstActionWithAbsenceData = processActions.find(a => a.periodoFaltasStart);
    const visitAction = processActions.find(a => a.actionType === 'visita');
    const contactAttempts = processActions.filter(a => a.actionType.startsWith('tentativa'));
    
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ');
    const schoolName = state.config?.schoolName || "Nome da Escola";
    const city = state.config?.city || "Cidade";

    let attemptsSummary = contactAttempts.map((attempt, index) => {
        return `
            <p class="ml-4">- <strong>${index + 1}ª Tentativa (${formatDate(attempt.contactDate || attempt.createdAt?.toDate())}):</strong> 
            ${attempt.contactSucceeded === 'yes' 
                ? `Contato realizado com ${formatText(attempt.contactPerson)} (Tipo: ${formatText(attempt.contactType)}). Justificativa: ${formatText(attempt.contactReason)}.` 
                : 'Não foi possível estabelecer contato.'}
            </p>
        `;
    }).join('');
    if (!attemptsSummary) attemptsSummary = "<p class='ml-4'>Nenhuma tentativa de contato registrada.</p>";

    const oficioHTML = `
        <div class="space-y-6 text-sm text-gray-800" style="font-family: 'Times New Roman', serif; line-height: 1.5;">
            <div class="text-center">
                ${getReportHeaderHTML()} <p class="font-bold uppercase mt-4">${schoolName}</p>
                <p>${city}, ${currentDate}.</p>
            </div>

            <div class="mt-8">
                <p class="font-bold text-base">OFÍCIO Nº ${String(finalOficioNumber).padStart(3, '0')}/${finalOficioYear}</p>
            </div>

            <div class="mt-8">
                <p><strong>Ao</strong></p>
                <p><strong>Conselho Tutelar</strong></p>
                <p><strong>Nesta</strong></p>
            </div>

            <div class="mt-8">
                <p><strong>Assunto:</strong> Encaminhamento de aluno infrequente.</p>
            </div>

            <div class="mt-8 text-justify">
                <p class="indent-8">Prezados(as) Conselheiros(as),</p>
                <p class="mt-4 indent-8">
                    Encaminhamos a V. Sa. o caso do(a) aluno(a) <strong>${student.name}</strong>,
                    regularmente matriculado(a) na turma <strong>${student.class}</strong> desta Unidade de Ensino,
                    filho(a) de <strong>${responsaveis}</strong>, residente no endereço: ${formatText(student.endereco)}.
                </p>
                <p class="mt-4 indent-8">
                    O(A) referido(a) aluno(a) apresenta um número de <strong>${firstActionWithAbsenceData?.absenceCount || '(não informado)'} faltas</strong>,
                    apuradas no período de ${formatPeriodo(firstActionWithAbsenceData?.periodoFaltasStart, firstActionWithAbsenceData?.periodoFaltasEnd)}.
                </p>
                <p class="mt-4 indent-8">
                    Informamos que a escola esgotou as tentativas de contato com a família, conforme descrito abaixo:
                </p>
                <div class="mt-2">${attemptsSummary}</div>
                <p class="mt-4 indent-8">
                    Adicionalmente, foi realizada uma visita in loco em <strong>${formatDate(visitAction?.visitDate)}</strong> pelo agente escolar <strong>${formatText(visitAction?.visitAgent)}</strong>.
                    Durante a visita, ${visitAction?.visitSucceeded === 'yes' 
                        ? `foi possível conversar com ${formatText(visitAction?.visitContactPerson)}, que justificou a ausência devido a: ${formatText(visitAction?.visitReason)}.`
                        : 'não foi possível localizar ou contatar os responsáveis.'}
                </p>
                <p class="mt-4 indent-8">
                    Diante do exposto e considerando o que preceitua o Art. 56 do Estatuto da Criança e do Adolescente (ECA), solicitamos as devidas providências deste Conselho para garantir o direito à educação do(a) aluno(a).
                </p>
            </div>

            <div class="mt-12 text-center">
                <p>Atenciosamente,</p>
            </div>
            
            <div class="signature-block pt-16 mt-8 space-y-12">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="mt-1">Diretor(a)</p>
                </div>
            </div>
        </div>
    `;

    document.getElementById('report-view-title').textContent = `Ofício Nº ${finalOficioNumber}`;
    document.getElementById('report-view-content').innerHTML = oficioHTML;
    openModal(dom.reportViewModalBackdrop);
};

/**
 * (Inalterado)
 * Lógica para determinar a próxima ação de busca ativa.
 */
export const handleNewAbsenceAction = (student) => {
    const { currentCycleActions } = getStudentProcessInfo(student.matricula);

    if (currentCycleActions.length > 0) {
        const lastAction = currentCycleActions[currentCycleActions.length - 1];
        let isPending = false;
        let pendingActionMessage = "Complete a etapa anterior para poder prosseguir.";

        if (lastAction.actionType.startsWith('tentativa')) {
            if (lastAction.contactSucceeded == null || lastAction.contactReturned == null) {
                isPending = true;
            }
        } 
        else if (lastAction.actionType === 'visita') {
            if (lastAction.visitSucceeded == null || lastAction.visitReturned == null) {
                isPending = true;
            }
        }
        else if (lastAction.actionType === 'encaminhamento_ct') {
            if (lastAction.ctFeedback == null || lastAction.ctReturned == null) {
                isPending = true;
                pendingActionMessage = "Preencha a devolutiva e o status de retorno do CT para poder analisar o processo.";
            }
        }

        if (isPending) {
            showToast(pendingActionMessage);
            openAbsenceModalForStudent(student, lastAction.actionType, lastAction);
            return; 
        }
    }

    openAbsenceModalForStudent(student);
};

/**
 * (Inalterado)
 * Ativa/Desativa campos de detalhe de contato (Família).
 */
export const toggleFamilyContactFields = (enable, fieldsContainer) => {
    const detailFields = fieldsContainer.querySelectorAll('input[type="date"], input[type="text"], textarea, select'); // Adicionado 'select'
    detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable;
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            input.value = '';
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

/**
 * (Inalterado)
 * Ativa/Desativa campos de detalhe de contato (Visita).
 */
export const toggleVisitContactFields = (enable, fieldsContainer) => {
     const detailFields = fieldsContainer.querySelectorAll('input[type="text"], textarea');
     detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable;
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            input.value = '';
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

/**
 * ATUALIZADO: (Item 9) Popula o novo campo "Tipo de Contato" no modal de Busca Ativa.
 */
export const openAbsenceModalForStudent = (student, forceActionType = null, data = null) => {
    dom.absenceForm.reset();

    dom.absenceForm.querySelectorAll('input, textarea').forEach(el => el.required = false);

    const isEditing = !!data;
    document.getElementById('absence-modal-title').innerText = isEditing ? 'Editar Ação de Busca Ativa' : 'Registar Ação de Busca Ativa';
    document.getElementById('absence-id').value = isEditing ? data.id : '';

    document.getElementById('absence-student-name').value = student.name || '';
    document.getElementById('absence-student-class').value = student.class || '';
    document.getElementById('absence-student-endereco').value = student.endereco || '';
    document.getElementById('absence-student-contato').value = student.contato || '';
    
    const { processId, currentCycleActions } = getStudentProcessInfo(student.matricula);
    document.getElementById('absence-process-id').value = data?.processId || processId;

    const finalActionType = forceActionType || (isEditing ? data.actionType : determineNextActionForStudent(student.matricula));
    document.getElementById('action-type').value = finalActionType;
    document.getElementById('action-type-display').value = actionDisplayTitles[finalActionType] || '';
    document.getElementById('action-type').dispatchEvent(new Event('change'));

    const absenceFieldsContainer = dom.absenceForm.querySelector('#absence-form > .bg-gray-50');
    const absenceInputs = absenceFieldsContainer.querySelectorAll('input');
    const firstAbsenceRecordInCycle = currentCycleActions.find(a => a.periodoFaltasStart);

    const readOnlyAbsenceData = (finalActionType !== 'tentativa_1' && !isEditing) || (isEditing && firstAbsenceRecordInCycle && data.id !== firstAbsenceRecordInCycle.id);

    if (!readOnlyAbsenceData) {
        document.getElementById('absence-start-date').required = true;
        document.getElementById('absence-end-date').required = true;
        document.getElementById('absence-count').required = true;
    }

    if (readOnlyAbsenceData) {
        const source = firstAbsenceRecordInCycle || data;
        document.getElementById('absence-start-date').value = source.periodoFaltasStart || '';
        document.getElementById('absence-end-date').value = source.periodoFaltasEnd || '';
        document.getElementById('absence-count').value = source.absenceCount || '';
        absenceInputs.forEach(input => input.readOnly = true);
    } else {
        absenceInputs.forEach(input => input.readOnly = false);
    }
    
    switch (finalActionType) {
        case 'tentativa_1':
        case 'tentativa_2':
        case 'tentativa_3':
            document.getElementById('meeting-date').required = true;
            document.getElementById('meeting-time').required = true;
            break;
        case 'visita':
            document.getElementById('visit-agent').required = true;
            document.getElementById('visit-date').required = true;
            break;
        case 'encaminhamento_ct':
            document.getElementById('ct-sent-date').required = true;
            break;
        case 'analise':
            document.getElementById('ct-parecer').required = true;
            break;
    }
    
    if (isEditing) {
        if (!readOnlyAbsenceData) {
            document.getElementById('absence-start-date').value = data.periodoFaltasStart || '';
            document.getElementById('absence-end-date').value = data.periodoFaltasEnd || '';
            document.getElementById('absence-count').value = data.absenceCount || '';
        }
        
        switch (data.actionType) {
            case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
                document.getElementById('meeting-date').value = data.meetingDate || '';
                document.getElementById('meeting-time').value = data.meetingTime || '';
                if(data.contactSucceeded) {
                    const radio = document.querySelector(`input[name="contact-succeeded"][value="${data.contactSucceeded}"]`);
                    radio.checked = true;
                    radio.dispatchEvent(new Event('change'));
                }
                // ATUALIZADO: (Item 9)
                document.getElementById('absence-contact-type').value = data.contactType || '';
                document.getElementById('contact-date').value = data.contactDate || '';
                document.getElementById('contact-person').value = data.contactPerson || '';
                document.getElementById('contact-reason').value = data.contactReason || '';
                if(data.contactReturned) document.querySelector(`input[name="contact-returned"][value="${data.contactReturned}"]`).checked = true;
                break;
            case 'visita':
                document.getElementById('visit-agent').value = data.visitAgent || '';
                document.getElementById('visit-date').value = data.visitDate || '';
                if(data.visitSucceeded) {
                    const radio = document.querySelector(`input[name="visit-succeeded"][value="${data.visitSucceeded}"]`);
                    radio.checked = true;
                    radio.dispatchEvent(new Event('change'));
                }
                document.getElementById('visit-contact-person').value = data.visitContactPerson || '';
                document.getElementById('visit-reason').value = data.visitReason || '';
                document.getElementById('visit-obs').value = data.visitObs || '';
                if (data.visitReturned) document.querySelector(`input[name="visit-returned"][value="${data.visitReturned}"]`).checked = true;
                break;
            case 'encaminhamento_ct':
                document.getElementById('ct-sent-date').value = data.ctSentDate || '';
                document.getElementById('ct-feedback').value = data.ctFeedback || '';
                if (data.ctReturned) document.querySelector(`input[name="ct-returned"][value="${data.ctReturned}"]`).checked = true;
                break;
            case 'analise':
                document.getElementById('ct-parecer').value = data.ctParecer || '';
                break;
        }
    } else {
          toggleFamilyContactFields(false, document.getElementById('family-contact-fields'));
          toggleVisitContactFields(false, document.getElementById('visit-contact-fields'));
    }
    
    openModal(dom.absenceModal);
};

/**
 * NOVO: (Problema 3) Abre o modal de configurações e preenche com os dados atuais.
 */
export const openSettingsModal = () => {
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.reset();
    }

    // Preenche os campos do formulário com os dados do estado global
    document.getElementById('school-name-input').value = state.config.schoolName || '';
    document.getElementById('school-city-input').value = state.config.city || '';
    document.getElementById('school-logo-input').value = state.config.schoolLogoUrl || '';

    // Abre o modal
    openModal(dom.settingsModal);
};
