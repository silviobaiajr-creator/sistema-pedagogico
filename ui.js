// =================================================================================
// ARQUIVO: ui.js
// RESPONSABILIDADE: Todas as funções que manipulam a UI (desenhar,
// abrir modais, gerar HTML).
//
// ATUALIZAÇÃO (REFATORAÇÃO PASSO 3 - LIMPEZA PÓS-AUTH):
// 1. Removidas as funções `showLoginView` e `showRegisterView`.
// 2. Essa responsabilidade agora pertence exclusivamente ao `module-auth.js`.
// =================================================================================

import { state, dom } from './state.js';
import { getStudentProcessInfo, determineNextActionForStudent } from './logic.js';
import { formatDate, formatTime, formatText, showToast, openModal, closeModal } from './utils.js';
// NOVO: Importa a constante que foi movida
import { actionDisplayTitles } from './reports.js'; 


// =================================================================================
// SEÇÃO 1: LÓGICA DA NOVA INTERFACE DE OCORRÊNCIAS
// =================================================================================

/**
 * ATUALIZADO (PONTO 2): Gerencia a UI de seleção de múltiplos alunos.
 * Agora, a tag exibe o NOME e a TURMA do aluno.
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
            
            // ATUALIZADO (PONTO 2): Adiciona 'gap-1.5' para espaçamento
            tag.className = 'bg-indigo-100 text-indigo-800 text-sm font-medium me-2 px-2.5 py-0.5 rounded-full flex items-center gap-1.5';
            
            // ATUALIZADO (PONTO 2): Mostra o nome e a turma
            tag.innerHTML = `
                <span>${student.name}</span>
                <span class="text-xs text-indigo-500 font-normal">(${student.class || 'S/ Turma'})</span>
                <button type="button" class="ms-1 text-indigo-600 hover:text-indigo-800">&times;</button>
            `;
            
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
 * Retorna o HTML para um selo (badge) de status.
 * (EXPORTADO para uso em reports.js)
 * @param {string} status - O status da ocorrência ('Pendente', 'Finalizada', 'Aguardando Contato').
 * @returns {string} HTML do selo de status.
 */
export const getStatusBadge = (status) => {
    const statusMap = {
        'Pendente': 'bg-yellow-100 text-yellow-800',
        'Aguardando Contato': 'bg-blue-100 text-blue-800', // NOVO
        'Finalizada': 'bg-green-100 text-green-800',
        'Resolvido': 'bg-green-100 text-green-800', // Alias
        'Cancelado': 'bg-gray-100 text-gray-800'
    };
    const colorClasses = statusMap[status] || 'bg-gray-100 text-gray-800';
    return `<span class="text-xs font-medium px-2.5 py-0.5 rounded-full ${colorClasses}">${status || 'N/A'}</span>`;
};


/**
 * Filtra e agrupa ocorrências com base nos filtros de estado e pesquisa.
 * (EXPORTADO para uso em reports.js)
 * @returns {Map<string, object>} Um Map onde a chave é o `occurrenceGroupId` e o valor é um objeto do incidente.
 */
export const getFilteredOccurrences = () => {
    // 1. Agrupa todas as ocorrências por `occurrenceGroupId`.
    const groupedByIncident = state.occurrences.reduce((acc, occ) => {
        const groupId = occ.occurrenceGroupId || `individual-${occ.id}`;
        
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

    // 2. Filtra os incidentes agrupados e CALCULA O STATUS GERAL.
    const filteredIncidents = new Map();
    for (const [groupId, incident] of groupedByIncident.entries()) {
        const mainRecord = incident.records[0]; 
        if (!mainRecord) continue; // Adiciona verificação de segurança
        
        const { startDate, endDate, status, type } = state.filtersOccurrences;
        const studentSearch = state.filterOccurrences.toLowerCase();

        // Lógica para calcular o status geral.
        const allResolved = incident.records.every(r => r.statusIndividual === 'Resolvido');
        const overallStatus = allResolved ? 'Finalizada' : 'Pendente';
        incident.overallStatus = overallStatus; // Adiciona o status calculado ao objeto do incidente.

        // Checagem de filtros (agora usa o 'overallStatus' para o filtro de status)
        if (startDate && mainRecord.date < startDate) continue;
        if (endDate && mainRecord.date > endDate) continue;
        if (status !== 'all' && overallStatus !== status) continue;
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
 * ATUALIZADO: (PONTO 3, 4 & 10) Renderiza a lista de ocorrências.
 * - Mostra o status individual de CADA aluno.
 * - Destaca o aluno que corresponde à busca.
 * - Torna o card do aluno um BOTÃO para abrir o acompanhamento.
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
    
    const sortedIncidents = [...filteredIncidents.values()].sort((a, b) => 
        new Date(b.records[0].date) - new Date(a.records[0].date)
    );

    let html = sortedIncidents.map(incident => {
        const mainRecord = incident.records[0];
        
        // ATUALIZADO (PONTO 4): Pega o termo da busca
        const studentSearch = state.filterOccurrences.toLowerCase();

        // ATUALIZADO (PONTO 3, 4, 10): Gera HTML para cada aluno como um botão clicável
        const studentDetailsHTML = [...incident.studentsInvolved.values()].map(student => {
            const record = incident.records.find(r => r.studentId === student.matricula);
            const status = record?.statusIndividual || 'Pendente';
            
            // Lógica de destaque (Ponto 4)
            const isMatch = studentSearch && student.name.toLowerCase().includes(studentSearch);
            const nameClass = isMatch ? 'font-bold text-yellow-800' : 'font-medium text-gray-700';
            // Se der match, a borda e o fundo mudam
            let borderClass = isMatch ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-gray-50';
            
            // Lógica de hover (Ponto 10)
            let hoverClass = isMatch ? 'hover:bg-yellow-100' : 'hover:bg-indigo-50';

            return `
                <button type="button" 
                        class="student-follow-up-trigger flex items-center gap-1.5 py-1 px-2 rounded-lg border ${borderClass} ${hoverClass} cursor-pointer transition-colors"
                        data-group-id="${incident.id}"
                        data-student-id="${student.matricula}"
                        title="Abrir acompanhamento de ${student.name}">
                    <span class="${nameClass}">${student.name}</span>
                    ${getStatusBadge(status)}
                </button>`;
        }).join('');
        // --- FIM DA ATUALIZAÇÃO ---


        // (Bug Kebab) A classe `overflow-hidden` foi removida do div principal.
        return `
            <div class="border rounded-lg bg-white shadow-sm">
                <div class="p-4 flex flex-col sm:flex-row justify-between items-start gap-3">
                    <div class="flex-grow">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="font-semibold text-gray-800">${mainRecord.occurrenceType || 'N/A'}</span>
                            ${getStatusBadge(incident.overallStatus)}
                        </div>

                        <!-- ATUALIZADO (PONTO 3): Exibe os detalhes dos alunos -->
                        <div class="text-sm text-gray-600 mt-2">
                            <strong class="block text-gray-500 text-xs font-bold uppercase mb-1.5">Alunos Envolvidos:</strong>
                            <div class="flex flex-wrap gap-2">
                                ${studentDetailsHTML}
                            </div>
                        </div>
                        
                        <!-- Atualizado espaçamento para mt-2 -->
                        <p class="text-xs text-gray-400 mt-2">Data: ${formatDate(mainRecord.date)} | ID: ${incident.id}</p>
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
                            <div class="kebab-menu-dropdown hidden absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border z-10">
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="follow-up" data-group-id="${incident.id}">
                                    <i class="fas fa-user-check mr-2 w-4"></i>Acompanhamento
                                </button>
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="edit" data-group-id="${incident.id}">
                                    <i class="fas fa-pencil-alt mr-2 w-4"></i>Editar Fato
                                </button>
                                <button class="kebab-action-btn menu-item w-full text-left" data-action="history" data-group-id="${incident.id}">
                                    <i class="fas fa-history mr-2 w-4"></i>Histórico
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
 * Abre o modal para registrar ou editar os dados COLETIVOS do incidente.
 * @param {object | null} incidentToEdit - O objeto do incidente a ser editado, ou null para criar um novo.
 */
export const openOccurrenceModal = (incidentToEdit = null) => {
    dom.occurrenceForm.reset();
    state.selectedStudents.clear();

    if (incidentToEdit) {
        // MODO DE EDIÇÃO (FATO COLETIVO)
        const mainRecord = incidentToEdit.records[0];
        document.getElementById('modal-title').innerText = 'Editar Fato da Ocorrência';
        document.getElementById('occurrence-group-id').value = incidentToEdit.id;

        incidentToEdit.studentsInvolved.forEach((student, studentId) => {
            state.selectedStudents.set(studentId, student);
        });

        // Preenche apenas os campos coletivos.
        document.getElementById('occurrence-type').value = mainRecord.occurrenceType || '';
        document.getElementById('occurrence-date').value = mainRecord.date || '';
        document.getElementById('description').value = mainRecord.description || '';

    } else {
        // MODO DE CRIAÇÃO
        document.getElementById('modal-title').innerText = 'Registar Nova Ocorrência';
        document.getElementById('occurrence-group-id').value = '';
        document.getElementById('occurrence-date').valueAsDate = new Date();
    }

    const studentInput = document.getElementById('student-search-input');
    const suggestionsDiv = document.getElementById('student-suggestions');
    const tagsContainer = document.getElementById('student-tags-container');
    setupStudentTagInput(studentInput, suggestionsDiv, tagsContainer);

    openModal(dom.occurrenceModal);
};

/**
 * ATUALIZADO (PONTO 11): Abre o novo modal de acompanhamento individual.
 * Agora aceita um ID de aluno para pré-seleção.
 * @param {string} groupId - O ID do grupo da ocorrência.
 * @param {string | null} [studentIdToPreselect=null] - O ID (matrícula) do aluno para carregar diretamente.
 */
export const openFollowUpModal = (groupId, studentIdToPreselect = null) => {
    const incident = getFilteredOccurrences().get(groupId);
    if (!incident) {
        return showToast('Erro: Incidente não encontrado.');
    }

    // Referências aos elementos do modal de Acompanhamento
    const studentSelect = document.getElementById('follow-up-student-select');
    const studentSelectWrapper = studentSelect.parentElement; // O <div> que envolve o select
    const followUpForm = document.getElementById('follow-up-form');
    const statusDisplay = document.getElementById('follow-up-status-display'); 
    
    studentSelect.innerHTML = '<option value="">Selecione um aluno...</option>';
    followUpForm.classList.add('hidden'); // Esconde o formulário
    if (statusDisplay) statusDisplay.innerHTML = ''; // Limpa o status

    // 1. Popula o <select> com os alunos envolvidos no incidente
    incident.studentsInvolved.forEach((student, studentId) => {
        const record = incident.records.find(r => r.studentId === studentId);
        if (record) {
            const option = document.createElement('option');
            option.value = record.id; // Usamos o ID do registro individual
            option.textContent = student.name;
            option.dataset.studentId = studentId; // Armazena o studentId (matrícula)
            studentSelect.appendChild(option);
        }
    });

    // 2. Adiciona um listener para quando o usuário escolher um aluno
    studentSelect.onchange = (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const recordId = selectedOption.value;
        
        if (!recordId) {
            followUpForm.classList.add('hidden');
            if (statusDisplay) statusDisplay.innerHTML = '';
            return;
        }
        
        // Pega o studentId (matrícula) do dataset da option selecionada
        const studentId = selectedOption.dataset.studentId;
        const record = incident.records.find(r => r.id === recordId);
        const student = incident.studentsInvolved.get(studentId);

        if (record && student) {
            // 3. Preenche o formulário com os dados individuais
            followUpForm.dataset.recordId = recordId;
            followUpForm.dataset.studentId = studentId;
            
            document.getElementById('follow-up-student-name').value = student.name;

            // --- Lógica de Status Automático (Exibição) ---
            let statusText = 'Pendente'; // Padrão se o contato foi feito
            if (record.parecerIndividual) {
                statusText = 'Resolvido';
            } else if (!record.contactSucceeded || record.contactSucceeded === 'no') {
                // Se 'contactSucceeded' for null, undefined, "" ou "no"
                statusText = 'Aguardando Contato';
            }
            if (statusDisplay) statusDisplay.innerHTML = `<strong>Status:</strong> ${getStatusBadge(statusText)}`;
            
            // Preenche os campos de acompanhamento
            document.getElementById('follow-up-actions').value = record.schoolActionsIndividual || '';
            document.getElementById('follow-up-family-actions').value = record.providenciasFamilia || ''; 
            document.getElementById('follow-up-parecer').value = record.parecerIndividual || '';
            
            // Preenche campos movidos (Convocação)
            document.getElementById('follow-up-meeting-date').value = record.meetingDate || ''; 
            document.getElementById('follow-up-meeting-time').value = record.meetingTime || ''; 

            // Preenche campos movidos (Contato)
            const contactRadio = document.querySelector(`input[name="follow-up-contact-succeeded"][value="${record.contactSucceeded}"]`);
            if (contactRadio) {
                contactRadio.checked = true;
            } else {
                document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio => radio.checked = false);
            }
            
            // Dispara o evento change para mostrar/esconder os campos de detalhe
            const contactFieldsContainer = document.getElementById('follow-up-family-contact-fields'); 
            if (contactFieldsContainer) {
                // Chama a função (agora corrigida)
                toggleFamilyContactFields(record.contactSucceeded === 'yes', contactFieldsContainer);
            }

            document.getElementById('follow-up-contact-type').value = record.contactType || ''; 
            document.getElementById('follow-up-contact-date').value = record.contactDate || ''; 
            
            followUpForm.classList.remove('hidden');
        }
    };
    
    // --- INÍCIO DA LÓGICA DE PRÉ-SELEÇÃO (PONTO 11) ---
    if (studentIdToPreselect) {
        // Encontra o 'recordId' (que é o value da option) com base no 'studentId'
        const record = incident.records.find(r => r.studentId === studentIdToPreselect);
        if (record) {
            studentSelect.value = record.id; // Define o valor do select
            studentSelectWrapper.classList.add('hidden'); // Esconde o dropdown
            studentSelect.dispatchEvent(new Event('change')); // Dispara o 'onchange' para preencher o formulário
        } else {
            // Fallback: se não encontrar o aluno (improvável), mostra o dropdown
            studentSelectWrapper.classList.remove('hidden');
            studentSelect.value = "";
            studentSelect.dispatchEvent(new Event('change')); // Dispara o 'onchange' para esconder o formulário
        }
    } else {
        // Comportamento normal (clique no kebab): mostra o dropdown e reseta
        studentSelectWrapper.classList.remove('hidden');
        studentSelect.value = "";
        studentSelect.dispatchEvent(new Event('change')); // Dispara o 'onchange' para esconder o formulário
    }
    // --- FIM DA LÓGICA DE PRÉ-SELEÇÃO ---


    // 4. Abre o modal
    openModal(dom.followUpModal);
};

// =================================================================================
// SEÇÃO 2: LÓGICA DA INTERFACE DE BUSCA ATIVA
// =================================================================================

// REMOVIDO: const actionDisplayTitles = { ... } (movido para reports.js)

/**
 * Renderiza a lista de Busca Ativa.
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
                <div class="border rounded-lg mb-4 bg-white shadow">
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
                    <div class="process-content" id="content-${processId}" style="overflow: hidden;"> <!-- Adicionado overflow: hidden aqui -->
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
 * Função central que decide qual conteúdo de aba deve ser renderizado.
 */
export const render = () => {
    if (state.activeTab === 'occurrences') {
        renderOccurrences();
    } else {
        renderAbsences();
    }
};

/**
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
 * Renderiza a lista de alunos no modal "Gerir Alunos".
 * A lógica de clique será gerenciada por delegação de eventos em `main.js`.
 */
export const renderStudentsList = () => {
    const tableBody = document.getElementById('students-list-table');
    if (!tableBody) return; // Adiciona guarda de segurança
    
    tableBody.innerHTML = ''; // Limpa a tabela antes de redesenhar.
    
    state.students.sort((a,b) => a.name.localeCompare(b.name)).forEach(student => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-4 py-2 text-sm text-gray-900">${student.name}</td>
            <td class="px-4 py-2 text-sm text-gray-500">${student.class}</td>
            <td class="px-4 py-2 text-right text-sm space-x-2">
                <button class="edit-student-btn text-yellow-600 hover:text-yellow-900" data-id="${student.matricula}" title="Editar">
                    <i class="fas fa-pencil-alt"></i>
                </button>
                <button class="delete-student-btn text-red-600 hover:text-red-900" data-id="${student.matricula}" title="Excluir">
                    <i class="fas fa-trash"></i>
                </button>
            </td>`;
        tableBody.appendChild(row);
    });
};


/**
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
 * Funções de exibição das telas de login/registro.
 * REMOVIDAS em 23/10/2025 - Agora em module-auth.js
 */
// export const showLoginView = () => { ... };
// export const showRegisterView = () => { ... };


/**
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
 * ATUALIZADO: (PONTO 5) Ativa/Desativa campos de detalhe de contato (Família).
 * Agora também remove a classe 'hidden' do contêiner.
 */
export const toggleFamilyContactFields = (enable, fieldsContainer) => {
    if (!fieldsContainer) return; // Guarda de segurança
    
    // ---- CORREÇÃO DO BUG (PONTO 5) ----
    // Controla a visibilidade do contêiner principal
    fieldsContainer.classList.toggle('hidden', !enable);
    // ---- FIM DA CORREÇÃO ----

    const detailFields = fieldsContainer.querySelectorAll('input[type="date"], input[type="text"], textarea, select');
    detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable; // Apenas requer se o "Sim" estiver marcado
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            // Não limpa o valor, pois o usuário pode querer ver o que estava preenchido
            // input.value = ''; 
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

/**
 * ATUALIZADO: (PONTO 5 - Bug Similar) Ativa/Desativa campos de detalhe de contato (Visita).
 * Agora também remove a classe 'hidden' do contêiner.
 */
export const toggleVisitContactFields = (enable, fieldsContainer) => {
     if (!fieldsContainer) return; // Guarda de segurança
     
     // ---- CORREÇÃO DO BUG (PONTO 5) ----
     fieldsContainer.classList.toggle('hidden', !enable);
     // ---- FIM DA CORREÇÃO ----
     
     const detailFields = fieldsContainer.querySelectorAll('input[type="text"], textarea');
     detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable;
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            // input.value = '';
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

/**
 * Abre e popula o modal de registro/edição de uma ação de Busca Ativa.
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
    // Usa a constante importada
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
                    if(radio) radio.checked = true;
                    if(radio) radio.dispatchEvent(new Event('change'));
                }
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
                    if(radio) radio.checked = true;
                    if(radio) radio.dispatchEvent(new Event('change'));
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
 * Abre o modal de configurações e preenche com os dados atuais.
 */
export const openSettingsModal = () => {
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.reset();
    }

    document.getElementById('school-name-input').value = state.config.schoolName || '';
    document.getElementById('school-city-input').value = state.config.city || '';
    document.getElementById('school-logo-input').value = state.config.schoolLogoUrl || '';

    openModal(dom.settingsModal);
};
