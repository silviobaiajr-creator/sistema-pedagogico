// =================================================================================
// ARQUIVO: ui.js
// RESPONSABILIDADE: Funções que manipulam a UI (desenhar listas principais,
// abrir modais específicos, gerar HTML compartilhado).
//
// ATUALIZAÇÃO (REFATORAÇÃO PASSO 1 - CORREÇÃO):
// 1. A constante `actionDisplayTitles` foi MOVIDA para `reports.js`.
// 2. Adicionada a importação de `actionDisplayTitles` de `reports.js`.
//
// ATUALIZAÇÃO (REFATORAÇÃO auth.js):
// 1. Removidas as funções `showLoginView` e `showRegisterView` (movidas para auth.js).
//
// ATUALIZAÇÃO (REFATORAÇÃO settings.js):
// 1. Removida a função `openSettingsModal` (movida para settings.js).
//
// ATUALIZAÇÃO (REFATORAÇÃO students.js):
// 1. Removidas as funções `renderStudentsList` e `resetStudentForm` (movidas para students.js).
//
// ATUALIZAÇÃO (REFATORAÇÃO occurrence.js):
// 1. Removidas as funções `setupStudentTagInput`, `getFilteredOccurrences`,
//    `renderOccurrences`, `openOccurrenceModal`, `openFollowUpModal`.
//    Elas foram movidas para o novo módulo `occurrence.js`.
// 2. `getStatusBadge` e `toggleFamilyContactFields` permanecem aqui por enquanto,
//    pois ainda podem ser usadas por outros módulos (como reports.js ou absence.js).
// =================================================================================

import { state, dom } from './state.js';
import { getStudentProcessInfo, determineNextActionForStudent } from './logic.js';
import { formatDate, formatTime, formatText, showToast, openModal, closeModal } from './utils.js';
// NOVO: Importa a constante que foi movida
import { actionDisplayTitles } from './reports.js';
// Importa a função de renderização do novo módulo
import { renderOccurrences } from './occurrence.js';


// =================================================================================
// SEÇÃO 1: FUNÇÕES DE UI COMPARTILHADAS / GERAIS
// =================================================================================

/**
 * Retorna o HTML para um selo (badge) de status.
 * (EXPORTADO para uso em reports.js e occurrence.js)
 * @param {string} status - O status da ocorrência ('Pendente', 'Finalizada', 'Aguardando Contato').
 * @returns {string} HTML do selo de status.
 */
export const getStatusBadge = (status) => {
    const statusMap = {
        'Pendente': 'bg-yellow-100 text-yellow-800',
        'Aguardando Contato': 'bg-blue-100 text-blue-800',
        'Finalizada': 'bg-green-100 text-green-800',
        'Resolvido': 'bg-green-100 text-green-800', // Alias
        'Cancelado': 'bg-gray-100 text-gray-800'
    };
    const colorClasses = statusMap[status] || 'bg-gray-100 text-gray-800';
    return `<span class="text-xs font-medium px-2.5 py-0.5 rounded-full ${colorClasses}">${status || 'N/A'}</span>`;
};

/**
 * ATUALIZADO: (PONTO 5) Ativa/Desativa campos de detalhe de contato (Família).
 * Agora também remove a classe 'hidden' do contêiner.
 * (Usado por occurrence.js e absence.js)
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
        // A obrigatoriedade pode variar entre os modais, então é melhor definir no modal específico
        // input.required = enable;
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

/**
 * ATUALIZADO: (PONTO 5 - Bug Similar) Ativa/Desativa campos de detalhe de contato (Visita).
 * Agora também remove a classe 'hidden' do contêiner.
 * (Usado por absence.js)
 */
export const toggleVisitContactFields = (enable, fieldsContainer) => {
     if (!fieldsContainer) return; // Guarda de segurança

     // ---- CORREÇÃO DO BUG (PONTO 5) ----
     fieldsContainer.classList.toggle('hidden', !enable);
     // ---- FIM DA CORREÇÃO ----

     const detailFields = fieldsContainer.querySelectorAll('input[type="text"], textarea');
     detailFields.forEach(input => {
        input.disabled = !enable;
        // input.required = enable; // Melhor definir no modal específico
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};


/**
 * Configura o autocomplete para as barras de busca principais.
 * (Usado para Ocorrências e Busca Ativa)
 */
export const setupAutocomplete = (inputId, suggestionsId, onSelectCallback) => {
    const input = document.getElementById(inputId);
    const suggestionsContainer = document.getElementById(suggestionsId);
    if (!input || !suggestionsContainer) return; // Segurança

    input.addEventListener('input', () => {
        const value = input.value.toLowerCase();

        // Se for a busca da Busca Ativa, atualiza o filtro no estado e renderiza a lista
        if (inputId === 'search-absences') {
            state.filterAbsences = value;
            renderAbsences(); // Renderiza apenas a lista de ausências
        }
        // Se for a busca de Ocorrências (agora gerenciada por occurrence.js),
        // o listener lá cuidará de chamar renderOccurrences()

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
                    // Chama o callback fornecido (ex: handleNewAbsenceAction)
                    if (onSelectCallback) onSelectCallback(student);

                    // Limpa o input e o filtro (se aplicável)
                    input.value = '';
                    if (inputId === 'search-absences') state.filterAbsences = '';

                    // Esconde sugestões
                    suggestionsContainer.classList.add('hidden');

                    // Renderiza a lista apropriada após a seleção
                    // (render() chama a função correta baseado na aba ativa)
                    render();
                });
                suggestionsContainer.appendChild(item);
            });
        } else {
            suggestionsContainer.classList.add('hidden');
        }
    });

    // Fecha sugestões ao clicar fora
    document.addEventListener('click', (e) => {
        if (!suggestionsContainer.contains(e.target) && e.target !== input) {
            suggestionsContainer.classList.add('hidden');
        }
    });
};


// =================================================================================
// SEÇÃO 2: LÓGICA DA INTERFACE DE BUSCA ATIVA (Permanece aqui por enquanto)
// =================================================================================

/**
 * Renderiza a lista de Busca Ativa.
 */
export const renderAbsences = () => {
    dom.loadingAbsences.classList.add('hidden');

    // Filtra primeiro pela busca no input
    const searchFiltered = state.absences
        .filter(a => {
            const student = state.students.find(s => s.matricula === a.studentId);
            // Inclui a ação se não houver filtro OU se o nome do aluno corresponder
            return !state.filterAbsences || (student && student.name.toLowerCase().startsWith(state.filterAbsences.toLowerCase()));
        });

    // Agrupa as ações filtradas por processo
    const groupedByProcess = searchFiltered.reduce((acc, action) => {
        const key = action.processId || `no-proc-${action.id}`;
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(action);
        return acc;
    }, {});

    // Filtra os GRUPOS (processos) com base nos selects
    const filteredGroupKeys = Object.keys(groupedByProcess).filter(processId => {
        const actions = groupedByProcess[processId];
        // Ordena ações dentro do processo para pegar a última corretamente
        actions.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

        const { processStatus, pendingAction, returnStatus } = state.filtersAbsences;

        // Filtro de Status do Processo
        const isConcluded = actions.some(a => a.actionType === 'analise');
        if (processStatus === 'in_progress' && isConcluded) return false;
        if (processStatus === 'concluded' && !isConcluded) return false;

        // Filtro de Ação Pendente (só se aplica a processos em andamento)
        if (pendingAction !== 'all' && !isConcluded) {
            const lastAction = actions[actions.length - 1];
            if (pendingAction === 'pending_contact') {
                const isPendingContact = (lastAction.actionType.startsWith('tentativa') && lastAction.contactSucceeded == null) || (lastAction.actionType === 'visita' && lastAction.visitSucceeded == null);
                if (!isPendingContact) return false;
            }
            if (pendingAction === 'pending_feedback') {
                const hasCtAction = actions.some(a => a.actionType === 'encaminhamento_ct');
                const ctAction = actions.find(a => a.actionType === 'encaminhamento_ct');
                const isPendingFeedback = hasCtAction && ctAction && !ctAction.ctFeedback; // Garante que ctAction existe
                if (!isPendingFeedback) return false;
            }
        } else if (pendingAction !== 'all' && isConcluded) {
            // Processos concluídos não têm ações pendentes
            return false;
        }


        // Filtro de Status de Retorno
        if (returnStatus !== 'all') {
            const lastActionWithReturnInfo = [...actions].reverse().find(a =>
                a.contactReturned != null || a.visitReturned != null || a.ctReturned != null
            );
            const currentReturnStatus = lastActionWithReturnInfo ? (lastActionWithReturnInfo.contactReturned ?? lastActionWithReturnInfo.visitReturned ?? lastActionWithReturnInfo.ctReturned) : 'pending';

            if (returnStatus === 'returned' && currentReturnStatus !== 'yes') return false;
            if (returnStatus === 'not_returned' && currentReturnStatus !== 'no') return false;

            // Para 'pending', verifica se NUNCA houve 'yes' ou 'no'
            const hasDefinitiveReturn = actions.some(a => a.contactReturned === 'yes' || a.contactReturned === 'no' || a.visitReturned === 'yes' || a.visitReturned === 'no' || a.ctReturned === 'yes' || a.ctReturned === 'no');
            if (returnStatus === 'pending' && hasDefinitiveReturn) return false;
             // Se o filtro for 'pending' e não houver retorno definitivo, mantém (não retorna false)
             if (returnStatus === 'pending' && !hasDefinitiveReturn) {
                 // Mantém o processo na lista
             } else if (returnStatus === 'pending') {
                 // Se o filtro é 'pending' mas já houve retorno, remove
                 return false;
             }
        }

        return true; // Passou por todos os filtros aplicáveis
    });

    // Exibe estado vazio apenas se NÃO houver filtros ativos
    const noFiltersActive = state.filterAbsences === '' && state.filtersAbsences.processStatus === 'all' && state.filtersAbsences.pendingAction === 'all' && state.filtersAbsences.returnStatus === 'all';

    if (filteredGroupKeys.length === 0) {
        dom.absencesListDiv.innerHTML = ''; // Limpa a lista
        if (noFiltersActive) {
            dom.emptyStateAbsences.classList.remove('hidden'); // Mostra estado vazio SEM filtros
        } else {
            dom.emptyStateAbsences.classList.add('hidden'); // Esconde estado vazio COM filtros
            // Opcional: Mostrar uma mensagem "Nenhum resultado para os filtros aplicados"
            dom.absencesListDiv.innerHTML = '<p class="text-center text-gray-500 py-4">Nenhum processo encontrado para os filtros selecionados.</p>';
        }
    } else {
        dom.emptyStateAbsences.classList.add('hidden'); // Esconde estado vazio

        // Ordena os processos filtrados pela data da última ação
        const sortedGroupKeys = filteredGroupKeys.sort((a, b) => {
            const actionsA = groupedByProcess[a];
            const actionsB = groupedByProcess[b];
            // Garante que haja ações antes de tentar acessar
            const lastActionA = actionsA.length > 0 ? actionsA[actionsA.length - 1] : { createdAt: { seconds: 0 } };
            const lastActionB = actionsB.length > 0 ? actionsB[actionsB.length - 1] : { createdAt: { seconds: 0 } };
            // Ordena do mais recente para o mais antigo
            return (lastActionB.createdAt?.seconds || 0) - (lastActionA.createdAt?.seconds || 0);
        });

        let html = '';
        for (const processId of sortedGroupKeys) {
            // As ações já foram ordenadas anteriormente ao filtrar
            const actions = groupedByProcess[processId];
            const firstAction = actions[0];
            const student = state.students.find(s => s.matricula === firstAction.studentId);
            if (!student) continue; // Pula se o aluno foi removido

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
                    <div class="process-content" id="content-${processId}" style="max-height: 0px; overflow: hidden;"> <!-- Inicia fechado -->
                        <div class="p-4 border-t border-gray-200">
                            <div class="space-y-4">
        `;

            actions.forEach(abs => {
                // Determina a data principal da ação
                const actionDate = abs.contactDate || abs.visitDate || abs.ctSentDate || abs.createdAt?.toDate()?.toISOString().split('T')[0] || '';
                // Status de retorno consolidado
                const returned = abs.contactReturned === 'yes' || abs.visitReturned === 'yes' || abs.ctReturned === 'yes';
                const notReturned = abs.contactReturned === 'no' || abs.visitReturned === 'no' || abs.ctReturned === 'no';

                // Botão de ação contextual
                let actionButtonHtml = '';
                if (abs.actionType.startsWith('tentativa')) {
                    actionButtonHtml = `<button class="notification-btn text-indigo-600 hover:text-indigo-900 text-xs font-semibold py-1 px-2 rounded-md bg-indigo-50" data-id="${abs.id}" title="Gerar Notificação">Notificação</button>`;
                } else if (abs.actionType === 'visita') {
                    const disabled = isConcluded || hasCtAction;
                    actionButtonHtml = `<button class="send-ct-btn text-blue-600 hover:text-blue-900 text-xs font-semibold py-1 px-2 rounded-md bg-blue-50 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}" data-id="${abs.id}" title="${disabled ? 'Encaminhamento já realizado ou processo concluído' : 'Enviar ao Conselho Tutelar'}" ${disabled ? 'disabled' : ''}>Enviar ao C.T.</button>`;
                } else if (abs.actionType === 'encaminhamento_ct') {
                     if(abs.oficioNumber) {
                          actionButtonHtml = `<button class="view-oficio-btn text-green-600 hover:text-green-900 text-xs font-semibold py-1 px-2 rounded-md bg-green-50" data-id="${abs.id}" title="Visualizar Ofício">Ver Ofício</button>`;
                     }
                } else {
                    // Espaço reservado para alinhar com outras linhas que têm botões
                    actionButtonHtml = `<span class="inline-block w-24"></span>`;
                }

                // Indicador de status da ação
                let statusHtml = '';
                if (abs.actionType.startsWith('tentativa')) {
                    statusHtml = (abs.contactSucceeded != null) // Se 'yes' ou 'no'
                        ? '<p class="text-xs text-green-600 font-semibold mt-1"><i class="fas fa-check"></i> Contato Realizado</p>'
                        : '<p class="text-xs text-yellow-600 font-semibold mt-1"><i class="fas fa-hourglass-half"></i> Aguardando Contato</p>';
                } else if (abs.actionType === 'visita') {
                     statusHtml = (abs.visitSucceeded != null) // Se 'yes' ou 'no'
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
                            <p class="font-medium text-gray-700">${actionDisplayTitles[abs.actionType] || abs.actionType}</p>
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
                                    <button class="kebab-action-btn menu-item w-full text-left ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}" data-action="edit" data-id="${abs.id}" ${isConcluded ? 'disabled title="Processo concluído"' : 'title="Editar Ação"'}>
                                        <i class="fas fa-pencil-alt mr-2 w-4"></i>Editar
                                    </button>
                                    <button class="kebab-action-btn menu-item menu-item-danger w-full text-left ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}" data-action="delete" data-id="${abs.id}" ${isConcluded ? 'disabled title="Processo concluído"' : 'title="Excluir Ação"'}>
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

/**
 * Abre e popula o modal de registro/edição de uma ação de Busca Ativa.
 */
export const openAbsenceModalForStudent = (student, forceActionType = null, data = null) => {
    dom.absenceForm.reset(); // Limpa o formulário

    // Reseta a obrigatoriedade de todos os campos
    dom.absenceForm.querySelectorAll('input, textarea, select').forEach(el => {
        el.required = false;
        // Habilita e remove estilo de desabilitado (será redefinido abaixo se necessário)
        el.disabled = false;
        el.readOnly = false;
        el.classList.remove('bg-gray-100', 'bg-gray-200', 'cursor-not-allowed');
         // Limpa radios
        if (el.type === 'radio') el.checked = false;
    });


    const isEditing = !!data; // Está editando se 'data' foi fornecido
    document.getElementById('absence-modal-title').innerText = isEditing ? 'Editar Ação de Busca Ativa' : 'Registar Nova Ação';
    document.getElementById('absence-id').value = isEditing ? data.id : ''; // ID do registro Firestore

    // Preenche dados do aluno (sempre somente leitura no modal)
    document.getElementById('absence-student-name').value = student.name || '';
    document.getElementById('absence-student-class').value = student.class || '';
    document.getElementById('absence-student-endereco').value = student.endereco || '';
    document.getElementById('absence-student-contato').value = student.contato || '';
    // Adiciona classe para indicar que são apenas leitura
    ['absence-student-name', 'absence-student-class', 'absence-student-endereco', 'absence-student-contato'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('bg-gray-100');
    });


    // Determina o ID do processo e as ações do ciclo atual
    const { processId, currentCycleActions } = getStudentProcessInfo(student.matricula);
    // Usa o ID do processo existente (se editando) ou o novo/calculado
    document.getElementById('absence-process-id').value = data?.processId || processId;

    // Determina o tipo de ação a ser exibida/editada
    // Se forçando um tipo (ex: clicou em editar), usa ele.
    // Se editando, usa o tipo da ação existente.
    // Se criando, determina a próxima ação lógica.
    const finalActionType = forceActionType || (isEditing ? data.actionType : determineNextActionForStudent(student.matricula));
    document.getElementById('action-type').value = finalActionType; // Input hidden com o valor chave
    // Mostra o título legível (somente leitura)
    document.getElementById('action-type-display').value = actionDisplayTitles[finalActionType] || finalActionType;
    document.getElementById('action-type-display').classList.add('bg-gray-100');

    // Mostra/Esconde os campos dinâmicos baseados no tipo de ação
    handleActionTypeChange(finalActionType); // Chama a função local que mostra/esconde divs

    // Lógica para campos de Faltas (Período e Quantidade)
    const absenceFieldsContainer = dom.absenceForm.querySelector('#absence-form > .bg-gray-50'); // Container dos campos de falta
    const absenceInputs = absenceFieldsContainer.querySelectorAll('input');
    const firstAbsenceRecordInCycle = currentCycleActions.find(a => a.periodoFaltasStart); // Encontra a 1ª ação que registrou as faltas

    // Os campos de falta são editáveis APENAS se for a 1ª tentativa E (criando OU editando a própria 1ª tentativa)
    const canEditAbsenceData = finalActionType === 'tentativa_1' && (!isEditing || (isEditing && data.actionType === 'tentativa_1'));

    if (canEditAbsenceData) {
        // Habilita e torna obrigatório
        absenceInputs.forEach(input => {
            input.readOnly = false;
            input.classList.remove('bg-gray-100');
            // Define como obrigatório apenas se puder editar
            if (['absence-start-date', 'absence-end-date', 'absence-count'].includes(input.id)) {
                input.required = true;
            }
        });
        // Preenche com dados existentes se estiver editando a 1ª tentativa
        if (isEditing) {
            document.getElementById('absence-start-date').value = data.periodoFaltasStart || '';
            document.getElementById('absence-end-date').value = data.periodoFaltasEnd || '';
            document.getElementById('absence-count').value = data.absenceCount || '';
        }
    } else {
        // Desabilita e preenche com dados da 1ª ação (ou da ação atual se for a 1ª)
        const sourceData = firstAbsenceRecordInCycle || (isEditing ? data : {}); // Usa a 1ª ação do ciclo OU os dados atuais se editando a 1ª
        document.getElementById('absence-start-date').value = sourceData.periodoFaltasStart || '';
        document.getElementById('absence-end-date').value = sourceData.periodoFaltasEnd || '';
        document.getElementById('absence-count').value = sourceData.absenceCount || '';
        absenceInputs.forEach(input => {
            input.readOnly = true;
            input.classList.add('bg-gray-100');
            input.required = false; // Não é obrigatório se não pode editar
        });
    }

    // Define campos obrigatórios específicos para cada tipo de ação
    // E preenche os dados se estiver editando
    switch (finalActionType) {
        case 'tentativa_1':
        case 'tentativa_2':
        case 'tentativa_3':
            document.getElementById('meeting-date').required = true;
            document.getElementById('meeting-time').required = true;
            // Preenche dados se editando
            if (isEditing) {
                document.getElementById('meeting-date').value = data.meetingDate || '';
                document.getElementById('meeting-time').value = data.meetingTime || '';
                if(data.contactSucceeded != null) { // Verifica se tem valor ('yes' ou 'no')
                    const radio = document.querySelector(`input[name="contact-succeeded"][value="${data.contactSucceeded}"]`);
                    if(radio) {
                        radio.checked = true;
                        // Dispara o 'change' para mostrar/esconder campos dependentes
                        radio.dispatchEvent(new Event('change'));
                        // Define 'required' nos campos dependentes APENAS se o radio 'yes' estiver marcado
                        if (data.contactSucceeded === 'yes') {
                            document.getElementById('absence-contact-type').required = true;
                            document.getElementById('contact-date').required = true;
                            document.getElementById('contact-person').required = true;
                            document.getElementById('contact-reason').required = true;
                        }
                    }
                } else {
                     // Se contactSucceeded for null, garante que campos dependentes não são required
                     toggleFamilyContactFields(false, document.getElementById('family-contact-fields'));
                }
                document.getElementById('absence-contact-type').value = data.contactType || '';
                document.getElementById('contact-date').value = data.contactDate || '';
                document.getElementById('contact-person').value = data.contactPerson || '';
                document.getElementById('contact-reason').value = data.contactReason || '';
                if(data.contactReturned != null) { // Verifica se tem valor ('yes' ou 'no')
                    const radioReturned = document.querySelector(`input[name="contact-returned"][value="${data.contactReturned}"]`);
                    if(radioReturned) radioReturned.checked = true;
                }
            } else {
                // Se criando, garante que campos dependentes iniciam escondidos
                toggleFamilyContactFields(false, document.getElementById('family-contact-fields'));
            }
            break;
        case 'visita':
            document.getElementById('visit-agent').required = true;
            document.getElementById('visit-date').required = true;
            // Preenche dados se editando
            if (isEditing) {
                document.getElementById('visit-agent').value = data.visitAgent || '';
                document.getElementById('visit-date').value = data.visitDate || '';
                if(data.visitSucceeded != null) { // Verifica se tem valor ('yes' ou 'no')
                    const radio = document.querySelector(`input[name="visit-succeeded"][value="${data.visitSucceeded}"]`);
                    if(radio) {
                        radio.checked = true;
                        // Dispara o 'change' para mostrar/esconder campos dependentes
                        radio.dispatchEvent(new Event('change'));
                         // Define 'required' nos campos dependentes APENAS se o radio 'yes' estiver marcado
                        if (data.visitSucceeded === 'yes') {
                            document.getElementById('visit-contact-person').required = true;
                            document.getElementById('visit-reason').required = true;
                            // visit-obs não é obrigatório
                        }
                    }
                } else {
                     // Se visitSucceeded for null, garante que campos dependentes não são required
                     toggleVisitContactFields(false, document.getElementById('visit-contact-fields'));
                }
                document.getElementById('visit-contact-person').value = data.visitContactPerson || '';
                document.getElementById('visit-reason').value = data.visitReason || '';
                document.getElementById('visit-obs').value = data.visitObs || '';
                if (data.visitReturned != null) { // Verifica se tem valor ('yes' ou 'no')
                    const radioReturned = document.querySelector(`input[name="visit-returned"][value="${data.visitReturned}"]`);
                    if(radioReturned) radioReturned.checked = true;
                }
            } else {
                 // Se criando, garante que campos dependentes iniciam escondidos
                 toggleVisitContactFields(false, document.getElementById('visit-contact-fields'));
            }
            break;
        case 'encaminhamento_ct':
            document.getElementById('ct-sent-date').required = true;
            // ct-feedback e ct-returned não são obrigatórios ao criar/editar o encaminhamento em si
            // Preenche dados se editando
            if (isEditing) {
                document.getElementById('ct-sent-date').value = data.ctSentDate || '';
                document.getElementById('ct-feedback').value = data.ctFeedback || '';
                if (data.ctReturned != null) { // Verifica se tem valor ('yes' ou 'no')
                    const radioReturned = document.querySelector(`input[name="ct-returned"][value="${data.ctReturned}"]`);
                     if(radioReturned) radioReturned.checked = true;
                }
            }
            break;
        case 'analise':
            document.getElementById('ct-parecer').required = true;
            // Preenche dados se editando
            if (isEditing) {
                document.getElementById('ct-parecer').value = data.ctParecer || '';
            }
            break;
    }

    openModal(dom.absenceModal); // Abre o modal configurado
};

/**
 * Mostra/Esconde os grupos de campos dinâmicos no modal de Busca Ativa.
 * (Movido de main.js)
 */
function handleActionTypeChange(action) {
    // Esconde todos os grupos dinâmicos primeiro
    document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));

    // Determina qual grupo mostrar
    let groupToShowId = null;
    if (action.startsWith('tentativa')) {
        groupToShowId = 'group-tentativas';
    } else {
        // Mapeia o tipo de ação para o ID do grupo correspondente
        const groupMap = {
            'visita': 'group-visita',
            'encaminhamento_ct': 'group-encaminhamento_ct',
            'analise': 'group-analise'
        };
        groupToShowId = groupMap[action];
    }

    // Mostra o grupo correto, se encontrado
    if (groupToShowId) {
        const groupElement = document.getElementById(groupToShowId);
        if (groupElement) {
            groupElement.classList.remove('hidden');
        }
    }
}


// =================================================================================
// SEÇÃO 4: FUNÇÃO DE RENDERIZAÇÃO PRINCIPAL
// =================================================================================

/**
 * Função central que decide qual conteúdo de aba deve ser renderizado.
 * Agora chama as funções de renderização dos módulos específicos.
 */
export const render = () => {
    if (state.activeTab === 'occurrences') {
        // Chama a função de renderização do módulo occurrence.js
        renderOccurrences();
    } else {
        // Chama a função de renderização local (ou de absence.js no futuro)
        renderAbsences();
    }
};

