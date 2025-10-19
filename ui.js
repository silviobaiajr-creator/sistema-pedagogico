// ARQUIVO: ui.js
// Responsabilidade: Todas as funções que manipulam a UI (desenhar,
// abrir modais, gerar HTML).

import { state, dom } from './state.js';
import { config } from './firebase.js';
import { getStudentProcessInfo, determineNextActionForStudent } from './logic.js';
import { formatDate, formatTime, formatText, formatPeriodo, showToast, openModal, closeModal } from './utils.js';
import { getStudentsDocRef, addRecord } from './firestore.js';
import { setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export const actionDisplayTitles = {
    tentativa_1: "1ª Tentativa de Contato",
    tentativa_2: "2ª Tentativa de Contato",
    tentativa_3: "3ª Tentativa de Contato",
    visita: "Visita In Loco",
    encaminhamento_ct: "Encaminhamento ao Conselho Tutelar",
    analise: "Análise"
};

export const renderOccurrences = () => {
    dom.loadingOccurrences.classList.add('hidden');
    
    let filtered = state.occurrences.filter(o => {
        const student = state.students.find(s => s.matricula === o.studentId);
        const nameMatch = student && student.name.toLowerCase().startsWith(state.filterOccurrences.toLowerCase());
        
        if (!nameMatch) return false;

        const { startDate, endDate } = state.filtersOccurrences;
        if (startDate && o.date < startDate) return false;
        if (endDate && o.date > endDate) return false;

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
        if (!acc[key]) {
            acc[key] = [];
        }
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
        const occurrences = groupedByStudent[studentId].sort((a, b) => new Date(b.date) - new Date(a.date));
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
    if (state.activeTab === 'occurrences') renderOccurrences();
    else renderAbsences();
};

export const openNotificationModal = (id) => {
    const data = state.occurrences.find(occ => occ.id === id);
    if (data) {
        const student = state.students.find(s => s.matricula === data.studentId) || {name: 'Aluno Removido', class: 'N/A', resp1: '', resp2: ''};
        document.getElementById('notification-title').innerText = 'Notificação de Ocorrência Escolar';
        const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ');
        document.getElementById('notification-content').innerHTML = `
            <div class="space-y-6 text-sm"><div class="text-center border-b pb-4"><h2 class="text-xl font-bold uppercase">${config.schoolName}</h2><h3 class="text-lg font-semibold mt-2">NOTIFICAÇÃO DE OCORRÊNCIA ESCOLAR</h3></div>
            <div class="pt-4"><p class="mb-2"><strong>Aos Responsáveis (${responsaveis}) pelo(a) aluno(a):</strong></p><p class="text-lg font-semibold">${formatText(student.name)}</p><p class="text-gray-600"><strong>Turma:</strong> ${formatText(student.class)}</p></div>
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
            <div class="border-t pt-16 mt-16"><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="text-center mt-1">Ciente do Responsável</p></div></div></div>`;
        openModal(dom.notificationModalBackdrop);
    }
};

export const openFichaViewModal = (id) => {
    const record = state.absences.find(abs => abs.id === id);
    if (!record) return showToast('Registro não encontrado.');
    const student = state.students.find(s => s.matricula === record.studentId) || {name: 'Aluno Removido', class: 'N/A', endereco: '', resp1: '', resp2: '', contato: ''};
    
    const attemptLabels = { tentativa_1: "primeira", tentativa_2: "segunda", tentativa_3: "terceira" };
    let title = "Notificação de Baixa Frequência";
    
    let body = '';
    const respons
