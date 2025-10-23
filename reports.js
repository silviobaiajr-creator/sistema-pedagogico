// =================================================================================
// ARQUIVO: reports.js (NOVO ARQUIVO)
// RESPONSABILIDADE: Gerar todos os documentos e relatórios (Atas, Fichas, 
// Ofícios, Relatórios Gerais e Históricos).
//
// DIDÁTICA: Este é o Passo 1 da refatoração. Estas funções foram movidas
// do arquivo `ui.js` para aumentar a coesão e separar as responsabilidades.
// =================================================================================

import { state, dom } from './state.js';
import { formatDate, formatTime, formatText, formatPeriodo, showToast, openModal, closeModal } from './utils.js';

// NOTA: Estas funções são importadas do ui.js, pois elas ainda
// residem lá. No futuro, elas também poderão ser movidas se necessário.
import { getFilteredOccurrences, getStatusBadge } from './ui.js';

/**
 * Helper para gerar o cabeçalho com logo.
 * @returns {string} HTML do cabeçalho do relatório.
 */
export const getReportHeaderHTML = () => {
    const logoUrl = state.config?.schoolLogoUrl || null;
    const schoolName = state.config?.schoolName || "Nome da Escola";

    if (logoUrl) {
        return `<div class="text-center mb-4"><img src="${logoUrl}" alt="Logo da Escola" class="max-w-full max-h-40 mx-auto"></div>`;
    }
    
    return `<div class="text-center border-b pb-4"><h2 class="text-xl font-bold uppercase">${schoolName}</h2></div>`;
};


/**
 * Abre um modal de seleção para o usuário escolher para qual aluno
 * de um incidente a notificação deve ser gerada.
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
 * ATUALIZADO: (PONTO 6) Gera e exibe a notificação formal.
 * Adiciona uma verificação para data/hora da reunião.
 * @param {object} incident - O objeto completo do incidente.
 * @param {object} student - O objeto do aluno selecionado.
 */
export const openIndividualNotificationModal = (incident, student) => {
    const data = incident.records.find(r => r.studentId === student.matricula) || incident.records[0];
    
    // ---- INÍCIO DA VERIFICAÇÃO (PONTO 6) ----
    // Verifica se os campos movidos (agora no acompanhamento) estão preenchidos
    if (!data.meetingDate || !data.meetingTime) {
        // Usa showToast, que já está importado
        showToast("Erro: É necessário definir a Data e o Horário da convocação.");
        showToast("Defina a Data e Horário no 'Acompanhamento' primeiro.");
        return; // Interrompe a geração da notificação
    }
    // ---- FIM DA VERIFICAÇÃO ----
    
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
 * Gera a Ata Formal, incluindo "Providências da Família".
 * @param {string} groupId - O ID do grupo da ocorrência.
 */
export const openOccurrenceRecordModal = (groupId) => {
    const incident = getFilteredOccurrences().get(groupId);
    if (!incident) return showToast('Incidente não encontrado.');
    
    const data = incident.records[0]; // Pega o registro principal para dados coletivos
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
                <div><h4 class="font-semibold">Status Geral:</h4><p>${formatText(incident.overallStatus)}</p></div>
                <div><h4 class="font-semibold">Aluno(s) Envolvido(s):</h4><p>${studentNames}</p></div>
                <div><h4 class="font-semibold">Responsáveis:</h4><p>${formatText(responsibleNames)}</p></div>
            </div>

            <div class="border-t pt-4 space-y-4">
                <div><h4 class="font-semibold mb-1">Descrição Detalhada dos Fatos:</h4><p class="text-gray-700 bg-gray-50 p-2 rounded-md whitespace-pre-wrap">${formatText(data.description)}</p></div>
                
                <div class="border-t pt-4">
                    <h4 class="text-md font-semibold text-gray-700 mb-2">Acompanhamentos Individuais</h4>
                    ${incident.records.map(rec => {
                        const student = incident.studentsInvolved.get(rec.studentId);
                        const statusIndividual = rec.statusIndividual || 'Pendente'; 
                        
                        return `
                        <div class="mt-2 p-3 border rounded-md bg-gray-50 break-inside-avoid">
                            <div class="flex justify-between items-center">
                                <p class="font-semibold">${student?.name || 'Aluno desconhecido'}</p>
                                ${getStatusBadge(statusIndividual)}
                            </div>
                            
                            ${(rec.meetingDate) ? `
                            <div class="mt-2 p-2 bg-indigo-50 rounded-md text-sm">
                                <p><strong>Reunião Agendada:</strong> Data: ${formatDate(rec.meetingDate)} | Horário: ${formatTime(rec.meetingTime)}</p>
                            </div>
                            ` : ''}

                            <p class="mt-2"><strong>Providências da Escola:</strong> ${formatText(rec.schoolActionsIndividual)}</p>
                            
                            <p class="mt-1"><strong>Providências da Família:</strong> ${formatText(rec.providenciasFamilia)}</p>

                            <p class="mt-1"><strong>Parecer/Desfecho:</strong> ${formatText(rec.parecerIndividual)}</p>
                        </div>
                        `;
                    }).join('')}
                </div>
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
 * Abre o modal de histórico de alterações de uma ocorrência.
 */
export const openHistoryModal = (groupId) => {
    const incident = getFilteredOccurrences().get(groupId);
    if (!incident) return showToast('Incidente não encontrado.');

    // Pega o histórico de todos os registros e junta
    const allHistory = incident.records.flatMap(r => r.history || []);
    
    // Ordena o histórico combinado pela data
    const history = allHistory.sort((a, b) => (b.timestamp.seconds || new Date(b.timestamp).getTime()) - (a.timestamp.seconds || new Date(a.timestamp).getTime()));

    const historyHTML = history.length > 0
        ? history.map(entry => {
            const timestamp = entry.timestamp.seconds ? new Date(entry.timestamp.seconds * 1000) : new Date(entry.timestamp);
            return `<div class="flex items-start space-x-4 py-3"><div class="flex-shrink-0"><div class="bg-gray-200 rounded-full h-8 w-8 flex items-center justify-center"><i class="fas fa-history text-gray-500"></i></div></div><div><p class="text-sm font-semibold text-gray-800">${entry.action}</p><p class="text-xs text-gray-500">Por: ${entry.user || 'Sistema'} em ${timestamp.toLocaleDateString('pt-BR')} às ${timestamp.toLocaleTimeString('pt-BR')}</p></div></div>`;
        }).join('')
        : '<p class="text-sm text-gray-500 text-center py-4">Nenhum histórico de alterações para este incidente.</p>';
    
    document.getElementById('history-view-title').textContent = `Histórico do Incidente`;
    document.getElementById('history-view-subtitle').innerHTML = `<strong>ID:</strong> ${groupId}<br><strong>Data:</strong> ${formatDate(incident.records[0].date)}`;
    document.getElementById('history-view-content').innerHTML = `<div class="divide-y divide-gray-200">${historyHTML}</div>`;
    openModal(document.getElementById('history-view-modal-backdrop'));
};

/**
 * Abre o modal de histórico de alterações de uma ação de Busca Ativa.
 */
export const openAbsenceHistoryModal = (processId) => {
    const processActions = state.absences.filter(a => a.processId === processId);
    if (processActions.length === 0) return showToast('Processo não encontrado.');
    
    const allHistory = processActions.flatMap(a => a.history || []);
    
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
 * Gera o relatório geral, incluindo "Providências da Família".
 */
export const generateAndShowGeneralReport = () => {
    const filteredIncidents = getFilteredOccurrences();
    if (filteredIncidents.size === 0) {
        return showToast('Nenhum incidente encontrado para os filtros selecionados.');
    }

    const { startDate, endDate, status, type } = state.filtersOccurrences;
    const studentFilter = state.filterOccurrences;
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const totalStudents = new Set([...filteredIncidents.values()].flatMap(i => [...i.studentsInvolved.keys()])).size;
    
    const occurrencesByType = [...filteredIncidents.values()].reduce((acc, incident) => {
        const occType = incident.records[0].occurrenceType || 'Não especificado';
        acc[occType] = (acc[occType] || 0) + 1;
        return acc;
    }, {});
    const sortedTypes = Object.entries(occurrencesByType).sort((a, b) => b[1] - a[1]);

    // O status GERAL (overallStatus) é usado para este gráfico
    const occurrencesByStatus = [...filteredIncidents.values()].reduce((acc, incident) => {
        const occStatus = incident.overallStatus || 'Pendente';
        acc[occStatus] = (acc[occStatus] || 0) + 1;
        return acc;
    }, {});
    
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
                    <h5 class="font-semibold text-center mb-2">Ocorrências por Status (Geral)</h5>
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
                            ${getStatusBadge(incident.overallStatus)}
                        </div>
                        <div class="p-4 space-y-3">
                            <p><strong>Alunos Envolvidos:</strong> ${studentNames}</p>
                            <div><h5 class="text-xs font-semibold uppercase text-gray-500">Descrição do Fato</h5><p class="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded">${formatText(mainRecord.description)}</p></div>
                            ${incident.records.map(rec => {
                                const student = incident.studentsInvolved.get(rec.studentId);
                                return `<div class="text-xs border-t mt-2 pt-2"><p class="font-bold">${student?.name || ''} (${rec.statusIndividual || 'Pendente'})</p><p><strong>Providências Escola:</strong> ${formatText(rec.schoolActionsIndividual)}</p><p><strong>Providências Família:</strong> ${formatText(rec.providenciasFamilia)}</p><p><strong>Parecer:</strong> ${formatText(rec.parecerIndividual)}</p></div>`;
                            }).join('')}
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
            data: { labels: chartDataByStatus.labels, datasets: [{ data: chartDataByStatus.data, backgroundColor: ['#f59e0b', '#10b981', '#6b7280'] }] }, // Amarelo, Verde, Cinza
            options: { responsive: true }
        });
    } catch (e) {
        console.warn("Chart.js não está carregado. Gráficos não serão exibidos.");
        document.getElementById('report-chart-by-type').parentElement.innerHTML = "<p class='text-center text-red-500 text-xs'>Chart.js não foi carregado. Gráficos indisponíveis.</p>";
        document.getElementById('report-chart-by-status').parentElement.innerHTML = "";
    }
};


/**
 * Gera o relatório geral de Busca Ativa com gráficos.
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
        
        if (studentFilter && (!student || !student.name.toLowerCase().includes(studentFilter.toLowerCase()))) return false;
        
        const isConcluded = proc.actions.some(a => a.actionType === 'analise');
        if (processStatus === 'in_progress' && isConcluded) return false;
        if (processStatus === 'concluded' && !isConcluded) return false;

        const lastReturnAction = [...proc.actions].reverse().find(a => a.contactReturned || a.visitReturned || a.ctReturned);
        const lastReturnStatus = lastReturnAction ? (lastReturnAction.contactReturned || lastReturnAction.visitReturned || lastReturnAction.ctReturned) : 'pending';
        
        if (returnStatus === 'returned' && lastReturnStatus !== 'yes') return false;
        if (returnStatus === 'not_returned' && lastReturnStatus !== 'no') return false;
        if (returnStatus === 'pending' && lastReturnStatus !== 'pending') return false;

        let isPendingContact = false, isPendingFeedback = false;
        if (!isConcluded) {
            isPendingContact = (lastAction.actionType.startsWith('tentativa') && lastAction.contactSucceeded == null) || (lastAction.actionType === 'visita' && lastAction.visitSucceeded == null);
            
            const ctAction = proc.actions.find(a => a.actionType === 'encaminhamento_ct');
            isPendingFeedback = ctAction && !ctAction.ctFeedback;
        }

        if (pendingAction === 'pending_contact' && !isPendingContact) return false;
        if (pendingAction === 'pending_feedback' && !isPendingFeedback) return false;
        
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
 * Abre a ficha de notificação de Busca Ativa.
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
 * Gera a Ficha Consolidada de Busca Ativa.
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
 * Gera o Ofício para o Conselho Tutelar.
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

