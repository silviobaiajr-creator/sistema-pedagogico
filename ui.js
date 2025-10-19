// ARQUIVO: ui.js (Revisão Geral + Logs)
// Responsabilidade: Todas as funções que manipulam a UI.

import { state, dom } from './state.js';
import { config } from './firebase.js';
import { getStudentProcessInfo, determineNextActionForStudent } from './logic.js';
import { formatDate, formatTime, formatText, formatPeriodo, showToast, openModal, closeModal } from './utils.js';
import { getStudentsDocRef, addRecord } from './firestore.js';
import { setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import Papa from "https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js";

// --- Constantes e Funções de Renderização (sem alterações lógicas grandes aqui) ---

export const actionDisplayTitles = {
    // ... (sem alterações)
    tentativa_1: "1ª Tentativa de Contato",
    tentativa_2: "2ª Tentativa de Contato",
    tentativa_3: "3ª Tentativa de Contato",
    visita: "Visita In Loco",
    encaminhamento_ct: "Encaminhamento ao Conselho Tutelar",
    analise: "Análise"
};

// ... (renderOccurrences, renderAbsences, render - sem alterações lógicas relevantes para o bug) ...
// Adicionadas verificações de existência de elementos DOM para robustez

export const renderOccurrences = () => {
    // Verifica se o elemento existe antes de tentar modificá-lo
    if (!dom.loadingOccurrences || !dom.occurrencesTitle || !dom.emptyStateOccurrences || !dom.occurrencesListDiv) {
        console.error("[ui.js] Elementos do DOM para ocorrências não encontrados!");
        return;
    }
    dom.loadingOccurrences.classList.add('hidden');

    let filtered = state.occurrences.filter(o => {
        const student = state.students.find(s => s.matricula === o.studentId);
        const nameMatch = student?.name?.toLowerCase().startsWith(state.filterOccurrences.toLowerCase());
        if (!nameMatch) return false;
        const { startDate, endDate } = state.filtersOccurrences;
        if (startDate && o.date && o.date < startDate) return false;
        if (endDate && o.date && o.date > endDate) return false;
        return true;
    });

    dom.occurrencesTitle.textContent = `Exibindo ${filtered.length} Registro(s) de Ocorrências`;

    if (filtered.length === 0) {
         dom.emptyStateOccurrences.classList.remove('hidden');
         dom.occurrencesListDiv.innerHTML = '';
         return;
    }
    dom.emptyStateOccurrences.classList.add('hidden');

    const groupedByStudent = filtered.reduce((acc, occ) => {
        const key = occ.studentId;
        if (!acc[key]) acc[key] = [];
        acc[key].push(occ);
        return acc;
    }, {});

    const sortedGroupKeys = Object.keys(groupedByStudent).sort((a, b) => {
        const studentA = state.students.find(s => s.matricula === a)?.name || '';
        const studentB = state.students.find(s => s.matricula === b)?.name || '';
        return studentA.localeCompare(studentB);
    });

    let html = '';
    for (const studentId of sortedGroupKeys) {
        const occurrences = (groupedByStudent[studentId] || []).sort((a, b) => new Date(b.date) - new Date(a.date));
        const student = state.students.find(s => s.matricula === studentId);
        if (!student) continue;

        html += `
            <div class="border rounded-lg overflow-hidden mb-4 bg-white shadow">
                <div class="process-header bg-gray-50 hover:bg-gray-100 cursor-pointer p-4 flex justify-between items-center" data-student-id-occ="${student.matricula}">
                    <div>
                        <p class="font-semibold text-gray-800 cursor-pointer hover:underline new-occurrence-from-history-btn" data-student-id="${student.matricula}">${student.name}</p>
                        <p class="text-sm text-gray-500">${occurrences.length} Ocorrência(s) registrada(s)</p>
                    </div>
                    <div class="flex items-center space-x-4">
                        <button class="generate-student-report-btn bg-purple-600 text-white font-bold py-1 px-3 rounded-lg shadow-md hover:bg-purple-700 text-xs no-print" data-student-id="${student.matricula}">
                            <i class="fas fa-file-invoice"></i> Relatório
                        </button>
                        <i class="fas fa-chevron-down transition-transform duration-300"></i>
                    </div>
                </div>
                <div class="process-content" id="content-occ-${student.matricula}">
                    <div class="border-t border-gray-200 divide-y divide-gray-200">
                        ${occurrences.map(occ => `
                            <div class="flex justify-between items-start py-3 px-4 hover:bg-gray-50 transition-colors duration-150">
                                <div>
                                    <p class="font-medium text-gray-800">${occ.occurrenceType || 'N/A'}</p>
                                    <p class="text-sm text-gray-500">Data: ${formatDate(occ.date)}</p>
                                </div>
                                <div class="whitespace-nowrap text-right text-sm font-medium space-x-2 flex items-center pl-4">
                                    <button class="view-btn text-indigo-600 hover:text-indigo-900 p-1 rounded-full hover:bg-indigo-100" data-id="${occ.id}" title="Ver Notificação"><i class="fas fa-eye"></i></button>
                                    <button class="edit-btn text-yellow-600 hover:text-yellow-900 p-1 rounded-full hover:bg-yellow-100" data-id="${occ.id}" title="Editar"><i class="fas fa-pencil-alt"></i></button>
                                    <button class="delete-btn text-red-600 hover:text-red-900 p-1 rounded-full hover:bg-red-100" data-id="${occ.id}" title="Excluir"><i class="fas fa-trash"></i></button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }
    dom.occurrencesListDiv.innerHTML = html;
};

export const renderAbsences = () => {
     if (!dom.loadingAbsences || !dom.emptyStateAbsences || !dom.absencesListDiv) {
        console.error("[ui.js] Elementos do DOM para ausências não encontrados!");
        return;
    }
    dom.loadingAbsences.classList.add('hidden');

    const searchFiltered = state.absences
        .filter(a => {
            const student = state.students.find(s => s.matricula === a.studentId);
            return student?.name?.toLowerCase().startsWith(state.filterAbsences.toLowerCase());
        });

    const groupedByProcess = searchFiltered.reduce((acc, action) => {
        const key = action.processId || `no-proc-${action.id}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(action);
        return acc;
    }, {});

    const filteredGroupKeys = Object.keys(groupedByProcess).filter(processId => {
        const actions = groupedByProcess[processId];
        if (!actions || actions.length === 0) return false;
        actions.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

        const { processStatus, pendingAction, returnStatus } = state.filtersAbsences;
        const isConcluded = actions.some(a => a.actionType === 'analise');
        if (processStatus === 'in_progress' && isConcluded) return false;
        if (processStatus === 'concluded' && !isConcluded) return false;

        const lastAction = actions[actions.length - 1];
        if (!lastAction) return false;

        if (pendingAction !== 'all') {
            if (isConcluded) return false;
            if (pendingAction === 'pending_contact') {
                const isPendingContact = (lastAction.actionType.startsWith('tentativa') && lastAction.contactSucceeded == null) || (lastAction.actionType === 'visita' && lastAction.visitSucceeded == null);
                if (!isPendingContact) return false;
            }
            if (pendingAction === 'pending_feedback') {
                const hasCtAction = actions.some(a => a.actionType === 'encaminhamento_ct');
                const ctAction = actions.find(a => a.actionType === 'encaminhamento_ct');
                const isPendingFeedback = hasCtAction && ctAction && !ctAction.ctFeedback;
                if (!isPendingFeedback) return false;
            }
        }

        if (returnStatus !== 'all') {
            const lastActionWithReturnInfo = [...actions].reverse().find(a =>
                (a.contactReturned != null) || (a.visitReturned != null) || (a.ctReturned != null)
            );
            if (!lastActionWithReturnInfo) {
                 if (returnStatus === 'returned' || returnStatus === 'not_returned') return false;
            } else {
                const lastStatus = lastActionWithReturnInfo.contactReturned ?? lastActionWithReturnInfo.visitReturned ?? lastActionWithReturnInfo.ctReturned;
                if (returnStatus === 'returned' && lastStatus !== 'yes') return false;
                if (returnStatus === 'not_returned' && lastStatus !== 'no') return false;
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
            const actionsA = groupedByProcess[a];
            const actionsB = groupedByProcess[b];
            const lastActionA = actionsA?.length > 0 ? actionsA.sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0))[0] : null;
            const lastActionB = actionsB?.length > 0 ? actionsB.sort((x, y) => (y.createdAt?.seconds || 0) - (x.createdAt?.seconds || 0))[0] : null;
            return (lastActionB?.createdAt?.seconds || 0) - (lastActionA?.createdAt?.seconds || 0);
        });

        let html = '';
        for (const processId of sortedGroupKeys) {
            const actions = groupedByProcess[processId]?.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
            if (!actions || actions.length === 0) continue;
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
                // ... (lógica dos botões - sem alterações) ...
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
                 // ... (lógica do statusHtml - sem alterações) ...
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
                            <button class="edit-absence-btn text-yellow-600 hover:text-yellow-900 ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}" data-id="${abs.id}" title="Editar Ação" ${isConcluded ? 'disabled' : ''}><i class="fas fa-pencil-alt fa-lg"></i></button>
                            <button class="delete-absence-btn text-red-600 hover:text-red-900 ${isConcluded ? 'opacity-50 cursor-not-allowed' : ''}" data-id="${abs.id}" data-action-type="${abs.actionType}" title="Excluir Ação" ${isConcluded ? 'disabled' : ''}><i class="fas fa-trash fa-lg"></i></button>
                        </div>
                    </div>
                `;
            });

            html += `
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
        }

        dom.absencesListDiv.innerHTML = html;
    }
};

export const render = () => {
    try {
        if (state.activeTab === 'occurrences') {
            renderOccurrences();
        } else {
            renderAbsences();
        }
    } catch (error) {
        console.error("[ui.js] Erro durante a renderização:", error);
        // Opcional: Mostrar uma mensagem de erro na UI
        // dom.appContainer.innerHTML = "<p class='text-red-500 text-center'>Ocorreu um erro ao exibir os dados.</p>";
    }
};


// ... (openNotificationModal, openFichaViewModal, openReportGeneratorModal - sem alterações lógicas) ...
// Adicionadas verificações de existência de elementos DOM para robustez

export const openNotificationModal = (id) => {
    const data = state.occurrences.find(occ => occ.id === id);
    if (data) {
        const student = state.students.find(s => s.matricula === data.studentId) || {name: 'Aluno Removido', class: 'N/A', resp1: '', resp2: ''};
        const titleEl = document.getElementById('notification-title');
        const contentEl = document.getElementById('notification-content');
        if (!titleEl || !contentEl) return; // Verifica

        titleEl.innerText = 'Notificação de Ocorrência Escolar';
        const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ');
        contentEl.innerHTML = `
            <div class="space-y-6 text-sm"><div class="text-center border-b pb-4"><h2 class="text-xl font-bold uppercase">${config.schoolName}</h2><h3 class="text-lg font-semibold mt-2">NOTIFICAÇÃO DE OCORRÊNCIA ESCOLAR</h3></div>
            <div class="pt-4"><p class="mb-2"><strong>Aos Responsáveis (${responsaveis || 'Não informado'}) pelo(a) aluno(a):</strong></p><p class="text-lg font-semibold">${formatText(student.name)}</p><p class="text-gray-600"><strong>Turma:</strong> ${formatText(student.class)}</p></div>
            <p class="text-justify">Prezados(as), vimos por meio desta notificá-los sobre uma ocorrência disciplinar envolvendo o(a) aluno(a) supracitado(a), registrada em <strong>${formatDate(data.date)}</strong>.</p>
            <div class="border-t pt-4 space-y-4">
                <div><h4 class="font-semibold mb-1">Tipo:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md">${formatText(data.occurrenceType)}</p></div>
                <div><h4 class="font-semibold mb-1">Descrição:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.description)}</p></div>
                <div><h4 class="font-semibold mb-1">Pessoas Envolvidas:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.involved)}</p></div>
                <div><h4 class="font-semibold mb-1">Providências da Escola:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.actionsTakenSchool)}</p></div>
                <div><h4 class="font-semibold mb-1">Providências da Família:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.actionsTakenFamily)}</p></div>
            </div>
            <p class="mt-4 text-justify">Diante do exposto, solicitamos o comparecimento de um responsável na coordenação pedagógica para uma reunião na seguinte data e horário:</p>
            <div class="mt-4 p-3 bg-indigo-100 text-indigo-800 rounded-md text-center font-semibold"><p><strong>Data:</strong> ${formatDate(data.meetingDate) || 'A ser agendada'}</p><p><strong>Horário:</strong> ${formatTime(data.meetingTime) || ''}</p></div>
            <div class="signature-block border-t pt-16 mt-16"><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="text-center mt-1">Ciente do Responsável</p></div></div></div>`; // Adicionado signature-block class
        openModal(dom.notificationModalBackdrop);
    }
};

export const openFichaViewModal = (id) => {
    const record = state.absences.find(abs => abs.id === id);
    if (!record) return showToast('Registro não encontrado.');
    const student = state.students.find(s => s.matricula === record.studentId) || {name: 'Aluno Removido', class: 'N/A', endereco: '', resp1: '', resp2: '', contato: ''};

    const titleEl = document.getElementById('ficha-view-title');
    const contentEl = document.getElementById('ficha-view-content');
    if (!titleEl || !contentEl) return; // Verifica

    const attemptLabels = { tentativa_1: "primeira", tentativa_2: "segunda", tentativa_3: "terceira" };
    let title = "Notificação de Baixa Frequência";
    let body = '';
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ');

    switch (record.actionType) {
         case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            body = `
                <p class="mt-4 text-justify">Prezados(as) Responsáveis, <strong>${responsaveis || 'Não informado'}</strong>,</p>
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
            <div class="text-center border-b pb-4">
                <h2 class="text-lg font-bold uppercase">${config.schoolName}</h2>
                <h3 class="font-semibold mt-1 uppercase">${title}</h3>
            </div>
            <div class="pt-4">
                <p><strong>Aluno(a):</strong> ${student.name}</p>
                <p><strong>Turma:</strong> ${student.class || ''}</p>
                <p><strong>Endereço:</strong> ${formatText(student.endereco)}</p>
                <p><strong>Contato:</strong> ${formatText(student.contato)}</p>
            </div>
            <div class="text-justify">${body}</div>
            <div class="signature-block border-t pt-16 mt-16">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="text-center mt-1">Ciente do Responsável</p>
                </div>
            </div>
        </div>`;

    titleEl.textContent = title;
    contentEl.innerHTML = contentHTML;
    openModal(dom.fichaViewModalBackdrop);
};

export const openReportGeneratorModal = (reportType) => {
    const select = document.getElementById('student-select');
    const titleEl = document.getElementById('report-generator-title');
    if (!select || !titleEl) return; // Verifica

    const records = reportType === 'occurrences' ? state.occurrences : state.absences;
    const studentIds = [...new Set(records.map(item => item.studentId))];
    const studentsInRecords = state.students.filter(s => studentIds.includes(s.matricula)).sort((a,b) => (a.name || '').localeCompare(b.name || ''));

    const title = reportType === 'occurrences' ? 'Gerar Relatório de Ocorrências' : 'Gerar Ficha Consolidada';
    titleEl.textContent = title;
    dom.reportGeneratorModal.dataset.reportType = reportType; // Guarda o tipo de relatório

    select.innerHTML = studentsInRecords.length > 0
        ? '<option value="">Selecione um aluno...</option>' + studentsInRecords.map(s => `<option value="${s.matricula}">${s.name}</option>`).join('')
        : '<option value="">Nenhum aluno com registros</option>';
    openModal(dom.reportGeneratorModal);
};

// ... (generateAndShowOficio, generateAndShowReport, generateAndShowConsolidatedFicha - sem alterações lógicas) ...
// Adicionadas verificações de existência de elementos DOM para robustez
export const generateAndShowOficio = (action, oficioNumber = null) => {
    if (!action) return showToast('Ação de origem não encontrada.');

    const finalOficioNumber = oficioNumber || action.oficioNumber;
    const finalOficioYear = action.oficioYear || new Date().getFullYear();

    if (!finalOficioNumber) return showToast('Número do ofício não encontrado.');

    const student = state.students.find(s => s.matricula === action.studentId);
    if (!student) return showToast('Aluno não encontrado.');

    const processActions = state.absences
        .filter(a => a.processId === action.processId)
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

    if (processActions.length === 0) return showToast('Nenhuma ação no processo.');

    const firstActionWithAbsenceData = processActions.find(a => a.periodoFaltasStart);
    const visitAction = processActions.find(a => a.actionType === 'visita');
    const contactAttempts = processActions.filter(a => a.actionType.startsWith('tentativa'));

    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ');

    let attemptsSummary = contactAttempts.map((attempt, index) => {
        return `
            <p class="ml-4">- <strong>${index + 1}ª Tentativa (${formatDate(attempt.contactDate || attempt.createdAt?.toDate())}):</strong>
            ${attempt.contactSucceeded === 'yes'
                ? `Contato realizado com ${formatText(attempt.contactPerson)}. Justificativa: ${formatText(attempt.contactReason)}.`
                : 'Não foi possível estabelecer contato.'}
            </p>
        `;
    }).join('');
    if (!attemptsSummary) attemptsSummary = "<p class='ml-4'>Nenhuma tentativa de contato registrada.</p>";

    const oficioHTML = `
        <div class="space-y-6 text-sm text-gray-800" style="font-family: 'Times New Roman', serif; line-height: 1.5;">
            <div class="text-center">
                <p class="font-bold uppercase">${config.schoolName}</p>
                <p>${config.city}, ${currentDate}.</p>
            </div>
            <div class="mt-8"><p class="font-bold text-base">OFÍCIO Nº ${String(finalOficioNumber).padStart(3, '0')}/${finalOficioYear}</p></div>
            <div class="mt-8"><p><strong>Ao</strong></p><p><strong>Conselho Tutelar</strong></p><p><strong>Nesta</strong></p></div>
            <div class="mt-8"><p><strong>Assunto:</strong> Encaminhamento de aluno infrequente.</p></div>
            <div class="mt-8 text-justify">
                <p class="indent-8">Prezados(as) Conselheiros(as),</p>
                <p class="mt-4 indent-8">
                    Encaminhamos a V. Sa. o caso do(a) aluno(a) <strong>${student.name}</strong>,
                    regularmente matriculado(a) na turma <strong>${student.class}</strong> desta Unidade de Ensino,
                    filho(a) de <strong>${responsaveis || 'Não informado'}</strong>, residente no endereço: ${formatText(student.endereco)}.
                </p>
                <p class="mt-4 indent-8">
                    O(A) referido(a) aluno(a) apresenta um número de <strong>${firstActionWithAbsenceData?.absenceCount || '(não informado)'} faltas</strong>,
                    apuradas no período de ${formatPeriodo(firstActionWithAbsenceData?.periodoFaltasStart, firstActionWithAbsenceData?.periodoFaltasEnd)}.
                </p>
                <p class="mt-4 indent-8">Informamos que a escola esgotou as tentativas de contato com a família, conforme descrito abaixo:</p>
                <div class="mt-2">${attemptsSummary}</div>
                <p class="mt-4 indent-8">
                    Adicionalmente, foi realizada uma visita in loco em <strong>${formatDate(visitAction?.visitDate)}</strong> pelo agente escolar <strong>${formatText(visitAction?.visitAgent)}</strong>.
                    Durante a visita, ${visitAction?.visitSucceeded === 'yes'
                        ? `foi possível conversar com ${formatText(visitAction?.visitContactPerson)}, que justificou a ausência devido a: ${formatText(visitAction?.visitReason)}.`
                        : 'não foi possível localizar ou contatar os responsáveis.'}
                </p>
                <p class="mt-4 indent-8">Diante do exposto e considerando o que preceitua o Art. 56 do Estatuto da Criança e do Adolescente (ECA), solicitamos as devidas providências deste Conselho para garantir o direito à educação do(a) aluno(a).</p>
            </div>
            <div class="mt-12 text-center"><p>Atenciosamente,</p></div>
            <div class="signature-block pt-16 mt-8 space-y-12">
                <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Diretor(a)</p></div>
            </div>
        </div>
    `;
    const titleEl = document.getElementById('report-view-title');
    const contentEl = document.getElementById('report-view-content');
    if(titleEl && contentEl) {
        titleEl.textContent = `Ofício Nº ${finalOficioNumber}`;
        contentEl.innerHTML = oficioHTML;
        openModal(dom.reportViewModalBackdrop);
    }
};

export const generateAndShowReport = (studentId) => {
    const studentOccurrences = state.occurrences.filter(occ => occ.studentId === studentId).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (studentOccurrences.length === 0) return showToast('Nenhuma ocorrência para este aluno.');

    const studentData = state.students.find(s => s.matricula === studentId);
    if (!studentData) return showToast('Dados do aluno não encontrados.');
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const reportHTML = `<div class="space-y-6 text-sm"><div class="text-center border-b pb-4"><h2 class="text-xl font-bold uppercase">${config.schoolName}</h2><h3 class="text-lg font-semibold mt-2">RELATÓRIO DE OCORRÊNCIAS</h3></div><div class="pt-4 text-left"><p><strong>ALUNO(A):</strong> ${studentData.name}</p><p><strong>TURMA:</strong> ${studentData.class}</p><p><strong>DATA:</strong> ${currentDate}</p></div>${studentOccurrences.map((occ, index) => `<div class="border-t pt-4 mt-4"><h4 class="font-semibold mb-2 text-base">OCORRÊNCIA ${index + 1} - Data: ${formatDate(occ.date)}</h4><div class="pl-4 border-l-2 border-gray-200 space-y-2"><div><p class="font-medium">Tipo:</p><p class="text-gray-700 bg-gray-50 p-2 rounded-md">${formatText(occ.occurrenceType)}</p></div><div><p class="font-medium">Descrição:</p><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(occ.description)}</p></div><div><p class="font-medium">Providências da Escola:</p><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(occ.actionsTakenSchool)}</p></div></div></div>`).join('')}<div class="signature-block border-t pt-16 mt-8"><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Assinatura da Coordenação</p></div></div></div>`; // Adicionado signature-block class

    const titleEl = document.getElementById('report-view-title');
    const contentEl = document.getElementById('report-view-content');
    if(titleEl && contentEl){
        titleEl.textContent = "Relatório de Ocorrências";
        contentEl.innerHTML = reportHTML;
        openModal(dom.reportViewModalBackdrop);
    }
};

export const generateAndShowConsolidatedFicha = (studentId, processId = null) => {
    let studentActions = state.absences.filter(action => action.studentId === studentId);
    if (processId) {
        studentActions = studentActions.filter(action => action.processId === processId);
    }
    studentActions.sort((a, b) => (a.createdAt?.toDate() || 0) - (b.createdAt?.toDate() || 0));

    if (studentActions.length === 0) return showToast('Nenhuma ação para este aluno neste processo.');
    const studentData = state.students.find(s => s.matricula === studentId);
    if (!studentData) return showToast('Dados do aluno não encontrados.');

    const findAction = (type) => studentActions.find(a => a.actionType === type) || {};
    const t1 = findAction('tentativa_1'), t2 = findAction('tentativa_2'), t3 = findAction('tentativa_3'), visita = findAction('visita'), ct = findAction('encaminhamento_ct'), analise = findAction('analise');
    const faltasData = t1.periodoFaltasStart ? t1 : (t2.periodoFaltasStart ? t2 : (t3.periodoFaltasStart ? t3 : (visita.periodoFaltasStart ? visita : {})));

    const fichaHTML = `
        <div class="space-y-4 text-sm">
            <div class="text-center border-b pb-4"><h2 class="text-lg font-bold uppercase">${config.schoolName}</h2><h3 class="font-semibold mt-1">Ficha de Acompanhamento da Busca Ativa</h3></div>
            <div class="border rounded-md p-3"><h4 class="font-semibold text-base mb-2">Identificação</h4><p><strong>Nome do aluno:</strong> ${studentData.name}</p><p><strong>Ano/Ciclo:</strong> ${studentData.class || ''}</p><p><strong>Endereço:</strong> ${formatText(studentData.endereco)}</p><p><strong>Contato:</strong> ${formatText(studentData.contato)}</p></div>
            <div class="border rounded-md p-3"><h4 class="font-semibold text-base mb-2">Faltas apuradas no período de:</h4><p><strong>Data de início:</strong> ${formatDate(faltasData.periodoFaltasStart)}</p><p><strong>Data de fim:</strong> ${formatDate(faltasData.periodoFaltasEnd)}</p><p><strong>Nº de faltas:</strong> ${formatText(faltasData.absenceCount)}</p></div>
            <div class="border rounded-md p-3 space-y-3"><h4 class="font-semibold text-base">Tentativas de contato...</h4><div class="pl-4"><p class="font-medium underline">1ª Tentativa:</p><p>Conseguiu contato? ${t1.contactSucceeded === 'yes' ? 'Sim' : t1.contactSucceeded === 'no' ? 'Não' : ''}</p><p>Dia: ${formatDate(t1.contactDate)}</p><p>Com quem? ${formatText(t1.contactPerson)}</p><p>Justificativa: ${formatText(t1.contactReason)}</p><p>Retornou? ${t1.contactReturned === 'yes' ? 'Sim' : t1.contactReturned === 'no' ? 'Não' : ''}</p></div><div class="pl-4 border-t pt-2"><p class="font-medium underline">2ª Tentativa:</p><p>Conseguiu contato? ${t2.contactSucceeded === 'yes' ? 'Sim' : t2.contactSucceeded === 'no' ? 'Não' : ''}</p><p>Dia: ${formatDate(t2.contactDate)}</p><p>Com quem? ${formatText(t2.contactPerson)}</p><p>Justificativa: ${formatText(t2.contactReason)}</p><p>Retornou? ${t2.contactReturned === 'yes' ? 'Sim' : t2.contactReturned === 'no' ? 'Não' : ''}</p></div><div class="pl-4 border-t pt-2"><p class="font-medium underline">3ª Tentativa:</p><p>Conseguiu contato? ${t3.contactSucceeded === 'yes' ? 'Sim' : t3.contactSucceeded === 'no' ? 'Não' : ''}</p><p>Dia: ${formatDate(t3.contactDate)}</p><p>Com quem? ${formatText(t3.contactPerson)}</p><p>Justificativa: ${formatText(t3.contactReason)}</p><p>Retornou? ${t3.contactReturned === 'yes' ? 'Sim' : t3.contactReturned === 'no' ? 'Não' : ''}</p></div></div>
            <div class="border rounded-md p-3 space-y-2"><h4 class="font-semibold text-base">Contato in loco...</h4><p>Agente: ${formatText(visita.visitAgent)}</p><p>Dia: ${formatDate(visita.visitDate)}</p><p>Conseguiu contato? ${visita.visitSucceeded === 'yes' ? 'Sim' : visita.visitSucceeded === 'no' ? 'Não' : ''}</p><p>Com quem? ${formatText(visita.visitContactPerson)}</p><p>Justificativa: ${formatText(visita.visitReason)}</p><p>Retornou? ${visita.visitReturned === 'yes' ? 'Sim' : visita.visitReturned === 'no' ? 'Não' : ''}</p><p>Obs: ${formatText(visita.visitObs)}</p></div>
            <div class="border rounded-md p-3 space-y-2"><h4 class="font-semibold text-base">Encaminhamento ao Conselho Tutelar</h4><p>Data envio: ${formatDate(ct.ctSentDate)}</p><p>Devolutiva: ${formatText(ct.ctFeedback)}</p><p>Retornou? ${ct.ctReturned === 'yes' ? 'Sim' : ct.ctReturned === 'no' ? 'Não' : ''}</p></div>
            <div class="border rounded-md p-3 space-y-2"><h4 class="font-semibold text-base">Análise</h4><p>Parecer BAE: ${formatText(analise.ctParecer)}</p></div>
            <div class="signature-block pt-16 mt-8 space-y-12"><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Diretor(a)</p></div><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Coordenador(a) Pedagógico(a)</p></div></div>
        </div>`;

     const titleEl = document.getElementById('report-view-title');
     const contentEl = document.getElementById('report-view-content');
     if(titleEl && contentEl){
        titleEl.textContent = "Ficha Consolidada de Busca Ativa";
        contentEl.innerHTML = fichaHTML;
        openModal(dom.reportViewModalBackdrop);
    }
};

// --- Funções que controlam a visibilidade e obrigatoriedade dos campos ---
// *** ESTA É A FUNÇÃO CRÍTICA PARA O SEU PROBLEMA ***
export const toggleFamilyContactFields = (enable, fieldsContainer) => {
    // Garante que fieldsContainer existe
    if (!fieldsContainer) {
        console.error("[ui.js] Container 'family-contact-fields' não encontrado!");
        return;
    }
    const detailFields = fieldsContainer.querySelectorAll('input[type="date"], input[type="text"], textarea');
    console.log(`[ui.js] toggleFamilyContactFields chamado com enable=${enable}. Campos encontrados: ${detailFields.length}`); // DEBUG
    detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable; // <-- Define como obrigatório ou não
        console.log(`[ui.js] Campo ${input.id}: required = ${input.required}, disabled = ${input.disabled}`); // DEBUG
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            // input.value = ''; // Comentado para não limpar se clicar sem querer
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

export const toggleVisitContactFields = (enable, fieldsContainer) => {
    // Garante que fieldsContainer existe
    if (!fieldsContainer) {
        console.error("[ui.js] Container 'visit-contact-fields' não encontrado!");
        return;
    }
     const detailFields = fieldsContainer.querySelectorAll('input[type="text"], textarea');
     console.log(`[ui.js] toggleVisitContactFields chamado com enable=${enable}. Campos encontrados: ${detailFields.length}`); // DEBUG
     detailFields.forEach(input => {
        input.disabled = !enable;
        input.required = enable; // <-- Define como obrigatório ou não
        console.log(`[ui.js] Campo ${input.id}: required = ${input.required}, disabled = ${input.disabled}`); // DEBUG
        if (!enable) {
            input.classList.add('bg-gray-200', 'cursor-not-allowed');
            // input.value = ''; // Comentado para não limpar se clicar sem querer
        } else {
            input.classList.remove('bg-gray-200', 'cursor-not-allowed');
        }
    });
};

// --- Funções para abrir os modais (com logs adicionados) ---
export const openAbsenceModalForStudent = (student, forceActionType = null, data = null) => {
    console.log("[ui.js] Abrindo modal de ausência para:", student?.name, "Editando:", !!data, "Forçar Ação:", forceActionType); // DEBUG
    if (!dom.absenceForm) {
        console.error("[ui.js] Formulário 'absence-form' não encontrado!");
        return;
    }
    dom.absenceForm.reset();
    dom.absenceForm.querySelectorAll('input, textarea').forEach(el => el.required = false);

    const isEditing = !!data;
    document.getElementById('absence-modal-title').innerText = isEditing ? 'Editar Ação de Busca Ativa' : 'Registar Ação de Busca Ativa';
    document.getElementById('absence-id').value = isEditing ? data.id : '';

    document.getElementById('absence-student-name').value = student?.name || '';
    document.getElementById('absence-student-class').value = student?.class || '';
    document.getElementById('absence-student-endereco').value = student?.endereco || '';
    document.getElementById('absence-student-contato').value = student?.contato || '';

    const { processId, currentCycleActions } = getStudentProcessInfo(student?.matricula);
    document.getElementById('absence-process-id').value = data?.processId || processId;

    const finalActionType = forceActionType || (isEditing ? data?.actionType : determineNextActionForStudent(student?.matricula));
    document.getElementById('action-type').value = finalActionType;
    document.getElementById('action-type-display').value = actionDisplayTitles[finalActionType] || '';
    console.log(`[ui.js] Tipo de ação definido: ${finalActionType}`); //DEBUG

    const absenceFieldsContainer = dom.absenceForm.querySelector('#absence-form > .bg-gray-50');
    const absenceInputs = absenceFieldsContainer?.querySelectorAll('input');
    const firstAbsenceRecordInCycle = currentCycleActions.find(a => a.periodoFaltasStart);
    const readOnlyAbsenceData = (finalActionType !== 'tentativa_1' && !isEditing) || (isEditing && firstAbsenceRecordInCycle && data?.id !== firstAbsenceRecordInCycle.id);

    if (absenceInputs) {
        if (!readOnlyAbsenceData) {
            document.getElementById('absence-start-date').required = true;
            document.getElementById('absence-end-date').required = true;
            document.getElementById('absence-count').required = true;
            console.log("[ui.js] Campos de data/contagem de falta definidos como obrigatórios."); //DEBUG
        }

        if (readOnlyAbsenceData) {
            const source = firstAbsenceRecordInCycle || data;
            document.getElementById('absence-start-date').value = source?.periodoFaltasStart || '';
            document.getElementById('absence-end-date').value = source?.periodoFaltasEnd || '';
            document.getElementById('absence-count').value = source?.absenceCount || '';
            absenceInputs.forEach(input => input.readOnly = true);
        } else {
            absenceInputs.forEach(input => input.readOnly = false);
            if (isEditing && data) {
                 document.getElementById('absence-start-date').value = data.periodoFaltasStart || '';
                 document.getElementById('absence-end-date').value = data.periodoFaltasEnd || '';
                 document.getElementById('absence-count').value = data.absenceCount || '';
            }
        }
    } else {
         console.error("[ui.js] Inputs de data/contagem de ausência não encontrados!");
    }

    switch (finalActionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
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
    }

    // Aplica os toggles e preenche dados de edição ANTES de disparar o 'change'
    const familyFieldsContainer = document.getElementById('family-contact-fields');
    const visitFieldsContainer = document.getElementById('visit-contact-fields');

    if (isEditing && data) {
        console.log("[ui.js] Preenchendo dados de edição para:", data.id); // DEBUG
        switch (data.actionType) {
            case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
                document.getElementById('meeting-date').value = data.meetingDate || '';
                document.getElementById('meeting-time').value = data.meetingTime || '';
                const hasContact = data.contactSucceeded === 'yes';
                if(data.contactSucceeded) {
                    const radio = document.querySelector(`input[name="contact-succeeded"][value="${data.contactSucceeded}"]`);
                    if(radio) radio.checked = true;
                    console.log(`[ui.js] Radio contact-succeeded preenchido: ${data.contactSucceeded}`); // DEBUG
                }
                if (familyFieldsContainer) {
                   toggleFamilyContactFields(hasContact, familyFieldsContainer); // Aplica toggle ANTES de preencher
                } else { console.error("[ui.js] Container 'family-contact-fields' não encontrado ao editar!"); }
                document.getElementById('contact-date').value = data.contactDate || '';
                document.getElementById('contact-person').value = data.contactPerson || '';
                document.getElementById('contact-reason').value = data.contactReason || '';
                if(data.contactReturned) {
                    const radioReturn = document.querySelector(`input[name="contact-returned"][value="${data.contactReturned}"]`);
                    if (radioReturn) radioReturn.checked = true;
                }
                break;
            case 'visita':
                 document.getElementById('visit-agent').value = data.visitAgent || '';
                 document.getElementById('visit-date').value = data.visitDate || '';
                 const hasVisitContact = data.visitSucceeded === 'yes';
                 if(data.visitSucceeded) {
                     const radioVisit = document.querySelector(`input[name="visit-succeeded"][value="${data.visitSucceeded}"]`);
                     if (radioVisit) radioVisit.checked = true;
                     console.log(`[ui.js] Radio visit-succeeded preenchido: ${data.visitSucceeded}`); // DEBUG
                 }
                 if(visitFieldsContainer) {
                    toggleVisitContactFields(hasVisitContact, visitFieldsContainer); // Aplica toggle ANTES de preencher
                 } else { console.error("[ui.js] Container 'visit-contact-fields' não encontrado ao editar!"); }
                 document.getElementById('visit-contact-person').value = data.visitContactPerson || '';
                 document.getElementById('visit-reason').value = data.visitReason || '';
                 document.getElementById('visit-obs').value = data.visitObs || '';
                 if (data.visitReturned) {
                      const radioVisitReturn = document.querySelector(`input[name="visit-returned"][value="${data.visitReturned}"]`);
                      if(radioVisitReturn) radioVisitReturn.checked = true;
                 }
                 break;
            case 'encaminhamento_ct':
                document.getElementById('ct-sent-date').value = data.ctSentDate || '';
                document.getElementById('ct-feedback').value = data.ctFeedback || '';
                if (data.ctReturned) {
                    const radioCtReturn = document.querySelector(`input[name="ct-returned"][value="${data.ctReturned}"]`);
                    if(radioCtReturn) radioCtReturn.checked = true;
                }
                break;
            case 'analise':
                document.getElementById('ct-parecer').value = data.ctParecer || '';
                break;
        }
    } else {
          // Garante que comecem desabilitados ao criar novo
          if (familyFieldsContainer) toggleFamilyContactFields(false, familyFieldsContainer);
          if (visitFieldsContainer) toggleVisitContactFields(false, visitFieldsContainer);
          console.log("[ui.js] Campos condicionais resetados para desabilitado (novo registro)."); // DEBUG
    }

    // Dispara o evento 'change' AQUI, depois de tudo preenchido e toggles aplicados
    console.log("[ui.js] Disparando evento 'change' para action-type."); // DEBUG
    document.getElementById('action-type').dispatchEvent(new Event('change'));

    openModal(dom.absenceModal);
};

export const openOccurrenceModalForStudent = (student) => {
    // ... (sem alterações lógicas, mas adicionado log) ...
     console.log("[ui.js] Abrindo modal de ocorrência para:", student?.name); // DEBUG
     if (!dom.occurrenceForm) return;
    dom.occurrenceForm.reset();
    document.getElementById('occurrence-id').value = '';
    document.getElementById('modal-title').innerText = 'Registar Nova Ocorrência';
    document.getElementById('student-name').value = student?.name || '';
    document.getElementById('student-class').value = student?.class || '';
    const dateInput = document.getElementById('occurrence-date');
    if (dateInput) {
        try { dateInput.valueAsDate = new Date(); } catch (e) { dateInput.value = new Date().toISOString().split('T')[0]; }
    }
    openModal(dom.occurrenceModal);
};

// --- Função que decide se abre a próxima ação ou bloqueia (com logs) ---
export const handleNewAbsenceAction = (student) => {
    console.log("[ui.js] handleNewAbsenceAction iniciado para:", student?.name); // DEBUG
    if (!student?.matricula) {
        showToast("Não foi possível identificar o aluno.");
        console.warn("[ui.js] handleNewAbsenceAction: Aluno inválido ou sem matrícula."); // DEBUG
        return;
    }
    const { currentCycleActions } = getStudentProcessInfo(student.matricula);
    console.log(`[ui.js] Ações no ciclo atual: ${currentCycleActions.length}`); // DEBUG

    if (currentCycleActions.length > 0) {
        const lastAction = currentCycleActions[currentCycleActions.length - 1];
        if (!lastAction) {
             console.warn("[ui.js] handleNewAbsenceAction: Última ação não encontrada, permitindo criar a primeira."); //DEBUG
            openAbsenceModalForStudent(student);
            return;
        }
        console.log(`[ui.js] Última ação: ${lastAction.actionType}, ID: ${lastAction.id}`); // DEBUG

        let isPending = false;
        let pendingActionMessage = "Responda 'Conseguiu contato?' e 'O aluno retornou?' na etapa anterior para prosseguir.";
        const isAnswered = (value) => value !== null && value !== undefined && value !== "";

        if (lastAction.actionType.startsWith('tentativa')) {
            if (!isAnswered(lastAction.contactSucceeded) || !isAnswered(lastAction.contactReturned)) {
                isPending = true;
                console.log("[ui.js] Bloqueio: Tentativa pendente.", lastAction); // DEBUG
            }
        }
        else if (lastAction.actionType === 'visita') {
            if (!isAnswered(lastAction.visitSucceeded) || !isAnswered(lastAction.visitReturned)) {
                isPending = true;
                 console.log("[ui.js] Bloqueio: Visita pendente.", lastAction); // DEBUG
            }
        }
        else if (lastAction.actionType === 'encaminhamento_ct') {
            if (!isAnswered(lastAction.ctFeedback) || !isAnswered(lastAction.ctReturned)) {
                isPending = true;
                pendingActionMessage = "Preencha a 'Devolutiva do C.T.' e se 'O aluno retornou?' na etapa anterior para analisar.";
                 console.log("[ui.js] Bloqueio: Encaminhamento CT pendente.", lastAction); // DEBUG
            }
        }

        if (isPending) {
             console.log("[ui.js] Ação bloqueada. Mostrando Toast e reabrindo modal anterior."); // DEBUG
            showToast(pendingActionMessage);
            openAbsenceModalForStudent(student, lastAction.actionType, lastAction);
            return;
        }
         console.log("[ui.js] Última ação completa. Abrindo modal para próxima ação."); // DEBUG
    } else {
        console.log("[ui.js] Nenhuma ação anterior. Abrindo modal para primeira ação."); // DEBUG
    }

    openAbsenceModalForStudent(student);
};

// ... (setupAutocomplete, renderStudentsList, resetStudentForm, showLoginView, showRegisterView - sem alterações lógicas) ...
// Adicionadas verificações de existência de elementos DOM para robustez

export const setupAutocomplete = (inputId, suggestionsId, onSelectCallback) => {
    const input = document.getElementById(inputId);
    const suggestionsContainer = document.getElementById(suggestionsId);
    if (!input || !suggestionsContainer) {
        console.error(`[ui.js] Elemento de autocomplete não encontrado: ${inputId} ou ${suggestionsId}`);
        return;
    }
    input.addEventListener('input', () => {
        const value = input.value.toLowerCase();
        if (inputId === 'search-occurrences') state.filterOccurrences = value;
        if (inputId === 'search-absences') state.filterAbsences = value;
        render();
        suggestionsContainer.innerHTML = '';
        if (!value) {
            suggestionsContainer.classList.add('hidden');
            return;
        }
        const filteredStudents = state.students.filter(s => s.name?.toLowerCase().startsWith(value)).slice(0, 5);
        if (filteredStudents.length > 0) {
            suggestionsContainer.classList.remove('hidden');
            filteredStudents.forEach(student => {
                const item = document.createElement('div');
                item.classList.add('suggestion-item');
                item.textContent = student.name;
                item.addEventListener('click', () => {
                    if (onSelectCallback) onSelectCallback(student);
                    input.value = '';
                    if (inputId === 'search-occurrences') state.filterOccurrences = '';
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
        if (suggestionsContainer && !suggestionsContainer.contains(e.target) && e.target !== input) {
            suggestionsContainer.classList.add('hidden');
        }
    });
};

export const renderStudentsList = () => {
    const tableBody = document.getElementById('students-list-table');
    if (!tableBody) { console.error("[ui.js] Elemento 'students-list-table' não encontrado!"); return; }
    tableBody.innerHTML = '';
    state.students.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(student => {
        const row = document.createElement('tr');
        const matricula = student.matricula || `temp_${Math.random()}`;
        row.innerHTML = `
            <td class="px-4 py-2 text-sm text-gray-900">${student.name || 'Nome não informado'}</td>
            <td class="px-4 py-2 text-sm text-gray-500">${student.class || 'Turma não informada'}</td>
            <td class="px-4 py-2 text-right text-sm space-x-2">
                <button class="edit-student-btn text-yellow-600 hover:text-yellow-900" data-id="${matricula}"><i class="fas fa-pencil-alt"></i></button>
                <button class="delete-student-btn text-red-600 hover:text-red-900" data-id="${matricula}"><i class="fas fa-trash"></i></button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    // Reanexa listeners DEPOIS de recriar o HTML
    attachStudentListListeners();
};

// Função separada para anexar listeners da lista de alunos
function attachStudentListListeners() {
    document.querySelectorAll('.edit-student-btn').forEach(btn => {
        // Remove listener antigo para evitar duplicação (mais seguro)
        // btn.replaceWith(btn.cloneNode(true)); // Clona para remover listeners antigos
        // btn = document.querySelector(`[data-id="${btn.dataset.id}"].edit-student-btn`); // Pega o novo botão clonado

        // Adiciona o listener
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const student = state.students.find(s => s.matricula === id);
            if (student) {
                document.getElementById('student-form-title').textContent = 'Editar Aluno';
                document.getElementById('student-id-input').value = student.matricula;
                const matriculaInput = document.getElementById('student-matricula-input');
                if (matriculaInput) {
                   matriculaInput.value = student.matricula;
                   matriculaInput.readOnly = true;
                   matriculaInput.classList.add('bg-gray-100');
                }
                document.getElementById('student-name-input').value = student.name || '';
                document.getElementById('student-class-input').value = student.class || '';
                document.getElementById('student-endereco-input').value = student.endereco || '';
                document.getElementById('student-contato-input').value = student.contato || '';
                document.getElementById('student-resp1-input').value = student.resp1 || '';
                document.getElementById('student-resp2-input').value = student.resp2 || '';
                document.getElementById('cancel-edit-student-btn')?.classList.remove('hidden');
            }
        });
    });

    document.querySelectorAll('.delete-student-btn').forEach(btn => {
         // btn.replaceWith(btn.cloneNode(true)); // Clona para remover listeners antigos
         // btn = document.querySelector(`[data-id="${btn.dataset.id}"].delete-student-btn`); // Pega o novo botão clonado

        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            const student = state.students.find(s => s.matricula === id);
            if (student && confirm(`Tem a certeza que quer remover o aluno "${student.name || id}"?`)) {
                const updatedList = state.students.filter(s => s.matricula !== id);
                try {
                    await setDoc(getStudentsDocRef(), { list: updatedList });
                    state.students = updatedList;
                    renderStudentsList(); // Re-renderiza a lista (que reanexará os listeners)
                    showToast("Aluno removido com sucesso.");
                } catch(error) {
                    console.error("Erro ao remover aluno:", error);
                    showToast("Erro ao remover aluno.");
                }
            }
        });
    });
}


export const resetStudentForm = () => {
    const studentForm = document.getElementById('student-form');
    if (studentForm) {
        document.getElementById('student-form-title').textContent = 'Adicionar Novo Aluno';
        studentForm.reset();
        document.getElementById('student-id-input').value = '';
        const matriculaInput = document.getElementById('student-matricula-input');
        if (matriculaInput) {
            matriculaInput.readOnly = false;
            matriculaInput.classList.remove('bg-gray-100');
        }
        document.getElementById('cancel-edit-student-btn')?.classList.add('hidden');
    } else {
        console.error("[ui.js] Formulário 'student-form' não encontrado para resetar!");
    }
};

export const showLoginView = () => {
    if (dom.registerView && dom.loginView) {
        dom.registerView.classList.add('hidden');
        dom.loginView.classList.remove('hidden');
    }
};

export const showRegisterView = () => {
     if (dom.registerView && dom.loginView) {
        dom.loginView.classList.add('hidden');
        dom.registerView.classList.remove('hidden');
    }
};
