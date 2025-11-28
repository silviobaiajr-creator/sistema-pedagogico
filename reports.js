
// =================================================================================
// ARQUIVO: reports.js
// VERSÃO: 4.0 (Com Exibição de Prints/Anexos nos Relatórios)
// =================================================================================

import { state, dom } from './state.js';
import { formatDate, formatTime, formatText, showToast, openModal, closeModal, getStatusBadge } from './utils.js';
import { roleIcons, defaultRole, getFilteredOccurrences } from './logic.js';
import { getIncidentByGroupId as fetchIncidentById, getStudentById, getOccurrencesForReport, getAbsencesForReport } from './firestore.js';


// Mapeamento de títulos para Busca Ativa (mantido)
export const actionDisplayTitles = {
    tentativa_1: "1ª Tentativa de Contato",
    tentativa_2: "2ª Tentativa de Contato",
    tentativa_3: "3ª Tentativa de Contato",
    visita: "Visita In Loco",
    encaminhamento_ct: "Encaminhamento ao Conselho Tutelar",
    analise: "Análise"
};

// --- HELPER DE DADOS DE ALUNO (ASSÍNCRONO E ROBUSTO) ---
const resolveStudentData = async (studentId, recordSource = null) => {
    // 1. Tenta memória local (Cache Rápido)
    let memoryStudent = state.students.find(s => s.matricula === studentId);
    
    // 2. Dados do Registo (Snapshot Histórico)
    const recordName = recordSource?.studentName;
    const recordClass = recordSource?.studentClass;

    // 3. Se não tiver memória, busca no servidor com TIMEOUT DE SEGURANÇA
    if (!memoryStudent) {
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Timeout")), 4000)
            );
            
            memoryStudent = await Promise.race([
                getStudentById(studentId),
                timeoutPromise
            ]);

        } catch (e) {
            console.warn(`Aviso: Não foi possível carregar dados completos do aluno ${studentId} (Timeout ou Erro). Usando dados parciais.`);
            if (e.message === "Timeout") showToast("Aviso: Demora na rede. Carregando dados parciais.");
        }
    }

    // 4. Montagem Final
    return {
        matricula: studentId,
        name: recordName || memoryStudent?.name || `Aluno (${studentId})`,
        class: recordClass || memoryStudent?.class || 'N/A',
        endereco: memoryStudent?.endereco || '',
        contato: memoryStudent?.contato || '',
        resp1: memoryStudent?.resp1 || '',
        resp2: memoryStudent?.resp2 || ''
    };
};


/**
 * Helper para gerar o cabeçalho com logo.
 */
export const getReportHeaderHTML = () => {
    const logoUrl = state.config?.schoolLogoUrl || null;
    const schoolName = state.config?.schoolName || "Nome da Escola";
    const city = state.config?.city || "Cidade";

    if (logoUrl) {
        return `
            <div class="text-center mb-4">
                <img src="${logoUrl}" alt="Logo da Escola" class="max-w-full max-h-24 mx-auto" onerror="this.onerror=null; this.src='https://placehold.co/150x50/indigo/white?text=Logo'; this.alt='Logo Placeholder';">
                <h2 class="text-xl font-bold uppercase mt-2">${schoolName}</h2>
                <p class="text-sm text-gray-600">${city}</p>
            </div>`;
    }

    return `
        <div class="text-center border-b pb-4">
            <h2 class="text-xl font-bold uppercase">${schoolName}</h2>
            <p class="text-sm text-gray-600">${city}</p>
        </div>`;
};

/**
 * Helper para renderizar imagem de print no relatório
 */
const getPrintHTML = (base64Image) => {
    if (!base64Image) return '';
    return `
        <div class="mt-2 mb-2 p-2 border border-gray-200 rounded bg-gray-50">
            <p class="text-xs font-bold text-gray-500 mb-1"><i class="fas fa-paperclip"></i> Comprovante de Contato (Anexo):</p>
            <img src="${base64Image}" class="max-w-full max-h-[300px] border rounded shadow-sm mx-auto block" alt="Comprovante">
        </div>
    `;
};


/**
 * Abre um modal de seleção para o usuário escolher para qual aluno
 * de um incidente a notificação deve ser gerada.
 */
export const openStudentSelectionModal = async (groupId) => {
    const incident = await fetchIncidentById(groupId);

    if (!incident || incident.participantsInvolved.size === 0) return showToast('Incidente não encontrado ou sem alunos associados.');

    const participants = [...incident.participantsInvolved.values()];

    if (participants.length === 1) {
        await openIndividualNotificationModal(incident, participants[0].student);
        return;
    }

    const modal = document.getElementById('student-selection-modal');
    const modalBody = document.getElementById('student-selection-modal-body');

    if (!modal || !modalBody) {
        return showToast('Erro: O modal de seleção de aluno não foi encontrado na página.');
    }

    modalBody.innerHTML = '';

    participants.forEach(participant => {
        const student = participant.student; 
        const btn = document.createElement('button');
        btn.className = 'w-full text-left bg-gray-50 hover:bg-sky-100 p-3 rounded-lg transition';
        btn.innerHTML = `<span class="font-semibold text-sky-800">${student.name}</span><br><span class="text-sm text-gray-600">Turma: ${student.class}</span>`;
        btn.onclick = async () => {
            await openIndividualNotificationModal(incident, student);
            closeModal(modal);
        };
        modalBody.appendChild(btn);
    });

    openModal(modal);
}

/**
 * Gera e exibe a notificação formal (Ocorrências).
 * Agora aceita specificAttempt para forçar a visualização de uma etapa passada.
 */
export const openIndividualNotificationModal = async (incident, studentObj, specificAttempt = null) => {
    const data = incident.records.find(r => r.studentId === studentObj.matricula);

    if (!data) {
        showToast(`Erro: Registro individual não encontrado para ${studentObj.name}.`);
        return;
    }

    if (!state.students.find(s => s.matricula === studentObj.matricula)) {
        showToast('Buscando dados completos do aluno...');
    }
    
    const student = await resolveStudentData(studentObj.matricula, data.studentName ? data : studentObj);

    // Define qual tentativa mostrar
    let attemptCount;
    
    if (specificAttempt) {
        attemptCount = parseInt(specificAttempt);
    } else {
        // Fallback: Lógica automática baseada no status atual
        attemptCount = 1;
        if (data.contactSucceeded_1 != null) attemptCount = 2;
        if (data.contactSucceeded_2 != null) attemptCount = 3;
    }

    // Seleciona a data/hora correta com base no attemptCount
    let meetingDateToShow = data.meetingDate; // Padrão (1ª)
    let meetingTimeToShow = data.meetingTime; // Padrão (1ª)

    if (attemptCount === 2) {
        meetingDateToShow = data.meetingDate_2;
        meetingTimeToShow = data.meetingTime_2;
    } else if (attemptCount === 3) {
        meetingDateToShow = data.meetingDate_3;
        meetingTimeToShow = data.meetingTime_3;
    }

    // Validação: Se tentou abrir uma notificação que ainda não foi agendada
    if (!meetingDateToShow || !meetingTimeToShow) {
        // Tenta retroceder se a atual estiver vazia (ex: abriu modal genérico mas só tem a 1ª agendada)
        if (!specificAttempt && attemptCount > 1) {
             // Fallback silencioso para a anterior
             if(attemptCount === 3 && data.meetingDate_2) { 
                 attemptCount = 2; meetingDateToShow = data.meetingDate_2; meetingTimeToShow = data.meetingTime_2;
             } else if (data.meetingDate) {
                 attemptCount = 1; meetingDateToShow = data.meetingDate; meetingTimeToShow = data.meetingTime;
             }
        }
        
        if (!meetingDateToShow) {
            showToast(`Aviso: Nenhuma data agendada para a ${attemptCount}ª Convocação.`);
            return;
        }
    }
    
    const attemptLabels = { 1: "primeira", 2: "segunda", 3: "terceira" };
    const attemptText = `Esta é a <strong>${attemptLabels[attemptCount] || 'uma'} tentativa de contato</strong> realizada pela escola.`;

    const responsibleNames = [student.resp1, student.resp2].filter(Boolean).join(' e ') || 'Responsáveis Legais';
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const identificationBlock = `
        <div class="border border-gray-300 rounded p-3 mb-4 bg-gray-50 text-xs sm:text-sm" style="font-family: 'Inter', sans-serif;">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><strong>Aluno(a):</strong> ${formatText(student.name)}</div>
                <div><strong>Turma:</strong> ${formatText(student.class)}</div>
                <div class="sm:col-span-2"><strong>Endereço:</strong> ${formatText(student.endereco)}</div>
                <div><strong>Contato:</strong> ${formatText(student.contato)}</div>
                <div><strong>Responsáveis:</strong> ${formatText(responsibleNames)}</div>
            </div>
        </div>
    `;

    document.getElementById('notification-title').innerText = 'Notificação de Ocorrência';
    document.getElementById('notification-content').innerHTML = `
        <div class="space-y-6 text-sm" style="font-family: 'Times New Roman', serif; line-height: 1.5;">
            ${getReportHeaderHTML()}
            
            <p class="text-right mt-4">${state.config?.city || "Cidade"}, ${currentDate}</p>

            <h3 class="text-lg font-semibold mt-4 text-center">NOTIFICAÇÃO DE OCORRÊNCIA ESCOLAR</h3>

            ${identificationBlock}
            
            <p class="text-justify mt-4">
                Prezados(as), vimos por meio desta notificá-los sobre um registro referente ao(à) aluno(a) acima identificado(a),
                referente a um incidente classificado como <strong>"${formatText(data.occurrenceType)}"</strong>, ocorrido em ${formatDate(data.date)}.
                ${attemptText}
            </p>

            <p class="text-justify bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded" style="font-family: 'Inter', sans-serif;">
                Conforme a legislação vigente, como a Lei de Diretrizes e Bases da Educação Nacional (LDB - Lei 9.394/96) e o
                Estatuto da Criança e do Adolescente (ECA - Lei 8.069/90), ressaltamos a importância da parceria e do
                acompanhamento ativo da família na vida escolar do(a) estudante, que é fundamental para seu desenvolvimento
                e para a manutenção de um ambiente escolar saudável.
            </p>

            <p class="mt-4 text-justify">
                Diante do exposto, solicitamos o comparecimento de um responsável na coordenação pedagógica para uma reunião
                na seguinte data e horário:
            </p>
            <div class="mt-4 p-3 bg-sky-100 text-sky-800 rounded-md text-center font-semibold" style="font-family: 'Inter', sans-serif;">
                <p><strong>Data:</strong> ${formatDate(meetingDateToShow)}</p>
                <p><strong>Horário:</strong> ${formatTime(meetingTimeToShow)}</p>
            </div>

            <div class="mt-8 signature-block">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="text-center mt-1">Ciente do Responsável</p>
                </div>
            </div>
             <div class="mt-8 signature-block">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="text-center mt-1">Assinatura da Gestão Escolar</p>
                </div>
            </div>
        </div>`;
    openModal(dom.notificationModalBackdrop);
};

// ==============================================================================
// --- ATA NARRATIVA ---
// ==============================================================================

export const openOccurrenceRecordModal = async (groupId) => {
    const incident = await fetchIncidentById(groupId);
    if (!incident || incident.records.length === 0) return showToast('Incidente não encontrado.');

    const mainRecord = incident.records[0]; 
    const city = state.config?.city || "Cidade";
    
    let fullDateText = "Data não registrada";
    try {
        const dateObj = new Date(mainRecord.date + 'T12:00:00'); 
        fullDateText = dateObj.toLocaleDateString('pt-BR', {
            day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' 
        });
    } catch (e) { console.error("Erro ao formatar data:", e); }

    // 1. Abertura
    let aberturaHTML = `
        <p class="indent-8">
            Aos ${fullDateText}, nas dependências desta unidade de ensino, foi lavrada a presente ata pela Coordenação Pedagógica para registrar os fatos e providências referentes ao incidente <strong>Nº ${incident.id}</strong>, classificado como <strong>"${formatText(mainRecord.occurrenceType)}"</strong>.
        </p>`;

    // 2. Fatos e Envolvidos
    const participantsDetails = [...incident.participantsInvolved.values()].map(p => {
        return `
            <li>
                <strong>${formatText(p.student.name)}</strong>
                (Turma: ${formatText(p.student.class || 'N/A')}),
                identificado(a) como <strong>[${formatText(p.role)}]</strong>.
            </li>`;
    }).join('');

    let fatosHTML = `
        <h4 class="section-title">DOS FATOS E ENVOLVIDOS</h4>
        <p class="indent-8">
            Constatou-se o seguinte fato:
        </p>
        <p class="report-block-quote">
            ${formatText(mainRecord.description)}
        </p>
        <p class="mt-2 indent-8">
            Estiveram envolvidos no incidente os seguintes alunos:
        </p>
        <ul class="list-disc list-inside ml-8 my-2">
            ${participantsDetails}
        </ul>`;

    // 3. Providências Imediatas
    let providenciasHTML = `
        <h4 class="section-title">DAS PROVIDÊNCIAS IMEDIATAS DA ESCOLA (AÇÃO 1)</h4>
        <p class="indent-8">
            Após a constatação do fato, a gestão escolar tomou as seguintes providências imediatas:
        </p>
        <p class="report-block-quote">
            ${formatText(mainRecord.providenciasEscola)}
        </p>`;

    // 4. Acompanhamentos (PADRONIZADO COM NOMENCLATURA DO HISTÓRICO)
    let acompanhamentosHTML = `
        <h4 class="section-title">DOS ACOMPANHAMENTOS E DESFECHO (AÇÕES 2-6)</h4>
        <p class="indent-8">
            Para o acompanhamento individual dos envolvidos, foram registradas as seguintes etapas:
        </p>
        <div class="space-y-3 mt-2">
            ${incident.records.map(rec => {
                const participant = incident.participantsInvolved.get(rec.studentId);
                const studentName = participant ? participant.student.name : (rec.studentName || 'Aluno desconhecido');
                
                let textoAcoesAluno = "";
                
                // 1ª Convocação
                if (rec.meetingDate) {
                    textoAcoesAluno += `<li><strong>Ação 2 (1ª Convocação):</strong> Agendada p/ ${formatDate(rec.meetingDate)} às ${formatTime(rec.meetingTime)}.</li>`;
                }
                
                // Tentativas (Feedback)
                for (let i = 1; i <= 3; i++) {
                    const succeeded = rec[`contactSucceeded_${i}`];
                    const date = rec[`contactDate_${i}`];
                    const person = rec[`contactPerson_${i}`];
                    const providencias = rec[`providenciasFamilia_${i}`];
                    const print = rec[`contactPrint_${i}`];
                    
                    if (succeeded != null) {
                        // Se teve feedback, houve tentativa. Se sucesso, mostra detalhes. Se não, mostra falha.
                        if (succeeded === 'yes') {
                            textoAcoesAluno += `<li><strong>Ação 3 (Feedback da ${i}ª Tentativa):</strong> Contato Realizado em ${formatDate(date)} com ${person || 'Responsável'}. Providências: ${formatText(providencias)}.</li>`;
                            // INSERE O PRINT SE HOUVER
                            textoAcoesAluno += getPrintHTML(print);
                        } else {
                            textoAcoesAluno += `<li><strong>Ação 3 (Feedback da ${i}ª Tentativa):</strong> Sem sucesso.</li>`;
                        }
                    }
                    
                    // Verifica se houve agendamento da próxima convocação (exceto para a 3ª tentativa que vai para desfecho)
                    if (i < 3) {
                        const nextMeetingDate = rec['meetingDate_' + (i+1)];
                        const nextMeetingTime = rec['meetingTime_' + (i+1)];
                        if (nextMeetingDate) {
                            textoAcoesAluno += `<li><strong>Ação 2 (${i+1}ª Convocação):</strong> Agendada p/ ${formatDate(nextMeetingDate)} às ${formatTime(nextMeetingTime)}.</li>`;
                        }
                    }
                }
                
                if (rec.oficioNumber) textoAcoesAluno += `<li><strong>Ação 4 (Enc. CT):</strong> Encaminhado ao Conselho Tutelar (Ofício Nº ${formatText(rec.oficioNumber)}/${formatText(rec.oficioYear)}).</li>`;
                if (rec.ctFeedback) textoAcoesAluno += `<li><strong>Ação 5 (Devolutiva CT):</strong> Devolutiva recebida: ${formatText(rec.ctFeedback)}.</li>`;
                if (rec.parecerFinal) textoAcoesAluno += `<li><strong>Ação 6 (Parecer Final):</strong> Desfecho registrado: ${formatText(rec.parecerFinal)}.</li>`;
                
                if(textoAcoesAluno === "") textoAcoesAluno = `<li>Nenhuma ação de acompanhamento registrada.</li>`;

                return `
                    <div class="report-block-quote-inner">
                        <strong class="font-semibold">${formatText(studentName)}</strong> (Status: ${rec.statusIndividual || 'Pendente'})
                        <ul class="list-disc list-inside ml-4 text-sm">
                            ${textoAcoesAluno}
                        </ul>
                    </div>`;
            }).join('')}
        </div>`;

    // 5. Fechamento e Assinaturas
    const displayOverallStatus = incident.overallStatus === 'Finalizada' ?
        "O presente incidente é considerado <strong>Finalizado</strong> pela gestão escolar." :
        "O presente incidente segue <strong>Pendente</strong> de acompanhamento pela gestão escolar.";

    let fechamentoHTML = `
        <p class="mt-4 indent-8">${displayOverallStatus}</p>
        <p class="mt-4 indent-8">Nada mais havendo a tratar, encerra-se a presente ata...</p>
        <p class="mt-4 text-center">${city}, ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.</p>`;

    let assinaturasHTML = `
        <div class="signature-block mt-12 space-y-12">
            <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="text-center mt-1 text-xs">Ciente do(s) Responsável(is)</p></div>
            <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="text-center mt-1 text-xs">Ciente do(s) Aluno(s)</p></div>
            <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="text-center mt-1 text-xs">Assinatura da Gestão Escolar</p></div>
        </div>`;

    document.getElementById('report-view-title').textContent = `Ata de Ocorrência Nº ${incident.id}`;
    document.getElementById('report-view-content').innerHTML = `
        <style>.report-narrative { font-family: 'Times New Roman', serif; font-size: 11pt; line-height: 1.6; text-align: justify; } .report-narrative .indent-8 { text-indent: 2rem; } .report-narrative .section-title { font-weight: bold; text-align: center; margin-top: 1rem; margin-bottom: 0.5rem; font-size: 11pt; } .report-narrative .report-block-quote { margin-left: 2rem; margin-right: 2rem; padding: 0.5rem 1rem; background-color: #f9fafb; border-left: 3px solid #e5e7eb; font-style: italic; font-family: 'Inter', sans-serif; font-size: 10pt; } .report-narrative .report-block-quote-inner { padding: 0.5rem 1rem; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0.25rem; font-family: 'Inter', sans-serif; font-size: 10pt; } .report-narrative .signature-block p { font-family: 'Inter', sans-serif; }</style>
        <div class="report-narrative space-y-2">
            ${getReportHeaderHTML()}
            <h3 class="text-lg font-semibold mt-4 text-center uppercase">ATA DE REGISTRO DE OCORRÊNCIA Nº ${incident.id}</h3>
            ${aberturaHTML} ${fatosHTML} ${providenciasHTML} ${acompanhamentosHTML} ${fechamentoHTML} ${assinaturasHTML}
        </div>`;
    openModal(dom.reportViewModalBackdrop);
};


/**
 * Abre o modal de histórico de alterações de uma ocorrência.
 */
export const openHistoryModal = async (groupId) => {
     const incident = await fetchIncidentById(groupId);

    if (!incident) return showToast('Incidente não encontrado.');

    const allHistory = incident.records.flatMap(r => r.history || []);

    const history = allHistory.sort((a, b) => (b.timestamp?.seconds || new Date(b.timestamp).getTime()) - (a.timestamp?.seconds || new Date(a.timestamp).getTime()));

    const historyHTML = history.length > 0
        ? history.map(entry => {
            const timestamp = entry.timestamp?.seconds ? new Date(entry.timestamp.seconds * 1000) : (entry.timestamp ? new Date(entry.timestamp) : new Date());
            return `<div class="flex items-start space-x-4 py-3"><div class="flex-shrink-0"><div class="bg-gray-200 rounded-full h-8 w-8 flex items-center justify-center"><i class="fas fa-history text-gray-500"></i></div></div><div><p class="text-sm font-semibold text-gray-800">${formatText(entry.action)}</p><p class="text-xs text-gray-500">Por: ${formatText(entry.user || 'Sistema')} em ${timestamp.toLocaleDateString('pt-BR')} às ${timestamp.toLocaleTimeString('pt-BR')}</p></div></div>`;
        }).join('')
        : '<p class="text-sm text-gray-500 text-center py-4">Nenhum histórico de alterações para este incidente.</p>';

    document.getElementById('history-view-title').textContent = `Histórico do Incidente`;
    const incidentDate = incident.records.length > 0 ? incident.records[0].date : null;
    document.getElementById('history-view-subtitle').innerHTML = `<strong>ID:</strong> ${groupId}<br><strong>Data:</strong> ${formatDate(incidentDate)}`;
    document.getElementById('history-view-content').innerHTML = `<div class="divide-y divide-gray-200">${historyHTML}</div>`;
    openModal(document.getElementById('history-view-modal-backdrop'));
};

/**
 * Abre o modal de histórico de alterações de um processo de Busca Ativa.
 */
export const openAbsenceHistoryModal = (processId) => {
    const processActions = state.absences.filter(a => a.processId === processId);
    if (processActions.length === 0) return showToast('Processo não encontrado.');

    const studentId = processActions[0].studentId;
    const studentName = formatText(processActions[0].studentName || state.students.find(s => s.matricula === studentId)?.name || `Aluno (${studentId})`);

    const allHistory = processActions.flatMap(a => a.history || []);

    processActions.forEach(action => {
        if (!action.history || action.history.length === 0) {
            allHistory.push({
                action: `Ação "${actionDisplayTitles[action.actionType]}" criada.`,
                user: action.createdBy || 'Sistema',
                timestamp: action.createdAt
            });
        }
    });

    const history = allHistory.sort((a, b) => {
        const timeA = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp).getTime();
        const timeB = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : new Date(a.timestamp).getTime();
        return timeB - timeA;
    });

    const historyHTML = history.length > 0
        ? history.map(entry => {
            const timestamp = entry.timestamp?.seconds ? new Date(entry.timestamp.seconds * 1000) : (entry.timestamp ? new Date(entry.timestamp) : new Date());
            return `<div class="flex items-start space-x-4 py-3"><div class="flex-shrink-0"><div class="bg-gray-200 rounded-full h-8 w-8 flex items-center justify-center"><i class="fas fa-history text-gray-500"></i></div></div><div><p class="text-sm font-semibold text-gray-800">${formatText(entry.action)}</p><p class="text-xs text-gray-500">Por: ${formatText(entry.user || 'Sistema')} em ${timestamp.toLocaleDateString('pt-BR')} às ${timestamp.toLocaleTimeString('pt-BR')}</p></div></div>`;
        }).join('')
        : '<p class="text-sm text-gray-500 text-center py-4">Nenhum histórico de alterações para este processo.</p>';

    document.getElementById('history-view-title').textContent = `Histórico do Processo`;
    document.getElementById('history-view-subtitle').innerHTML = `
        <strong>Aluno:</strong> ${studentName}<br>
        <strong class="text-xs">ID do Processo:</strong> ${processId}
    `;
    document.getElementById('history-view-content').innerHTML = `<div class="divide-y divide-gray-200">${historyHTML}</div>`;
    openModal(document.getElementById('history-view-modal-backdrop'));
};


/**
 * Abre a ficha de notificação de Busca Ativa.
 */
export const openFichaViewModal = async (id) => {
    const record = state.absences.find(abs => abs.id === id);
    if (!record) return showToast('Registro não encontrado.');
    
    if (!state.students.find(s => s.matricula === record.studentId)) {
        showToast('Buscando dados completos do aluno...');
    }
    const student = await resolveStudentData(record.studentId, record);

    // --- CORREÇÃO: Recupera dados de faltas do processo (se não estiverem no registo atual) ---
    let absenceCount = record.absenceCount;
    let periodoStart = record.periodoFaltasStart;
    let periodoEnd = record.periodoFaltasEnd;

    if (!absenceCount || !periodoStart) {
        // Procura no histórico do processo
        const processActions = state.absences.filter(a => a.processId === record.processId);
        const firstActionWithData = processActions.find(a => a.periodoFaltasStart && a.absenceCount);
        
        if (firstActionWithData) {
            absenceCount = firstActionWithData.absenceCount;
            periodoStart = firstActionWithData.periodoFaltasStart;
            periodoEnd = firstActionWithData.periodoFaltasEnd;
        }
    }
    // ----------------------------------------------------------------------------------------

    const attemptLabels = { tentativa_1: "primeira", tentativa_2: "segunda", tentativa_3: "terceira" };
    let title = "Notificação de Baixa Frequência";

    let body = '';
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ') || 'Responsáveis Legais';
    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const identificationBlock = `
        <div class="border border-gray-300 rounded p-3 mb-4 bg-gray-50 text-xs sm:text-sm" style="font-family: 'Inter', sans-serif;">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><strong>Aluno(a):</strong> ${formatText(student.name)}</div>
                <div><strong>Turma:</strong> ${formatText(student.class)}</div>
                <div class="sm:col-span-2"><strong>Endereço:</strong> ${formatText(student.endereco)}</div>
                <div><strong>Contato:</strong> ${formatText(student.contato)}</div>
                <div><strong>Responsáveis:</strong> ${formatText(responsaveis)}</div>
            </div>
        </div>
    `;

    switch (record.actionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            body = `
                ${identificationBlock}
                <p class="mt-4 text-justify">Prezados(as) Responsáveis,</p>
                <p class="mt-4 text-justify">
                    Vimos por meio desta notificar que o(a) estudante acima identificado(a),
                    acumulou <strong>${formatText(absenceCount)} faltas</strong> no período de ${formatDate(periodoStart)} a ${formatDate(periodoEnd)},
                    configurando baixa frequência escolar. Esta é a <strong>${attemptLabels[record.actionType]} tentativa de contato</strong> realizada pela escola.
                </p>
                <p class="mt-4 text-justify bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded" style="font-family: 'Inter', sans-serif;">
                    Ressaltamos que, conforme a Lei de Diretrizes e Bases da Educação Nacional (LDB - Lei 9.394/96) e o Estatuto da Criança e do Adolescente (ECA - Lei 8.069/90),
                    é dever da família zelar pela frequência do(a) estudante à escola. A persistência das faltas implicará no acionamento do Conselho Tutelar para as devidas providências.
                </p>
                ${(record.meetingDate && record.meetingTime) ? `
                <p class="mt-4 text-justify">
                    Diante do exposto, solicitamos o comparecimento de um(a) responsável na <strong>coordenação pedagógica</strong> desta unidade escolar para tratarmos do assunto na data e horário abaixo:
                </p>
                <div class="mt-4 p-3 bg-gray-100 rounded-md text-center" style="font-family: 'Inter', sans-serif;">
                    <p><strong>Data:</strong> ${formatDate(record.meetingDate)}</p>
                    <p><strong>Horário:</strong> ${formatTime(record.meetingTime)}</p>
                </div>
                ` : `
                <p class="mt-4 text-justify">Diante do exposto, solicitamos o comparecimento de um(a) responsável na <strong>coordenação pedagógica</strong> desta unidade escolar com urgência para tratarmos do assunto.</p>
                `}
            `;
            break;
        case 'visita':
            title = actionDisplayTitles[record.actionType];
            body = `
                ${identificationBlock}
                <p class="mt-4 text-justify">Prezados(as) Responsáveis,</p>
                <p class="mt-4 text-justify">
                    Notificamos que na data de <strong>${formatDate(record.visitDate)}</strong>, o agente escolar <strong>${formatText(record.visitAgent)}</strong> realizou uma visita domiciliar
                    referente ao acompanhamento de frequência do(a) aluno(a) acima identificado(a).
                </p>
                <p class="mt-2"><strong>Justificativa do responsável (se houver):</strong> ${formatText(record.visitReason)}</p>
            `;
            break;
        default:
            title = actionDisplayTitles[record.actionType] || 'Documento de Busca Ativa';
            body = `
                ${identificationBlock}
                <p class="mt-4">Registro de ação administrativa referente à busca ativa do(a) aluno(a) <strong>${student.name}</strong>.</p>`;
            break;
    }

    const contentHTML = `
        <div class="space-y-6 text-sm" style="font-family: 'Times New Roman', serif; line-height: 1.5;">
            ${getReportHeaderHTML()}
            
            <p class="text-right mt-4">${state.config?.city || "Cidade"}, ${currentDate}</p>

            <h3 class="font-semibold mt-1 uppercase text-center">${title}</h3>
            
            <div class="text-justify">${body}</div>
            
            <div class="mt-8 signature-block">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="text-center mt-1">Ciente do Responsável</p>
                </div>
            </div>
             <div class="mt-8 signature-block">
                <div class="text-center w-2/3 mx-auto">
                    <div class="border-t border-gray-400"></div>
                    <p class="text-center mt-1">Assinatura da Gestão Escolar</p>
                </div>
            </div>
        </div>`;

    document.getElementById('ficha-view-title').textContent = title;
    document.getElementById('ficha-view-content').innerHTML = contentHTML;
    openModal(dom.fichaViewModalBackdrop);
};


/**
 * Gera a Ficha Consolidada de Busca Ativa.
 * ATUALIZADO: Inclui prints de contato (se houver).
 */
export const generateAndShowConsolidatedFicha = async (studentId, processId = null) => {
    let studentActions = state.absences.filter(action => action.studentId === studentId);

    if (processId) {
        studentActions = studentActions.filter(action => action.processId === processId);
    } else {
        console.warn("Gerando ficha consolidada sem processId específico.");
    }

    studentActions.sort((a, b) => (a.createdAt?.toDate() || 0) - (b.createdAt?.toDate() || 0));

    if (studentActions.length === 0) return showToast('Nenhuma ação para este aluno neste processo/ciclo.');
    
    if (!state.students.find(s => s.matricula === studentId)) {
        showToast('Buscando dados completos do aluno...');
    }
    const studentData = await resolveStudentData(studentId, studentActions[0]);

    const findAction = (type) => studentActions.find(a => a.actionType === type) || {};
    const t1 = findAction('tentativa_1'), t2 = findAction('tentativa_2'), t3 = findAction('tentativa_3'), visita = findAction('visita'), ct = findAction('encaminhamento_ct'), analise = findAction('analise');

    const faltasData = studentActions.find(a => a.periodoFaltasStart) || {};
    const currentProcessId = processId || faltasData.processId || 'N/A';

    // Helper interno para renderizar o bloco da tentativa somente se existir ID
    const renderAttemptBlock = (attempt, label, addBorder) => {
        if (!attempt || !attempt.id) return ''; // Se não tem ID, retorna string vazia
        return `
            <div class="pl-4 ${addBorder ? 'border-t pt-2' : ''}">
                <p class="font-medium underline">${label}:</p>
                <p><strong>Data da Convocação:</strong> ${formatDate(attempt.meetingDate)} às ${formatTime(attempt.meetingTime)}</p>
                <p><strong>Conseguiu contato?</strong> ${attempt.contactSucceeded === 'yes' ? 'Sim' : attempt.contactSucceeded === 'no' ? 'Não' : ''}</p>
                <p><strong>Dia do contato:</strong> ${formatDate(attempt.contactDate)}</p>
                <p><strong>Justificativa:</strong> ${formatText(attempt.contactReason)}</p>
                ${getPrintHTML(attempt.contactPrint)}
            </div>`;
    };

    // Gera o HTML das tentativas dinamicamente
    let attemptsHTML = '';
    attemptsHTML += renderAttemptBlock(t1, '1ª Tentativa', false);
    attemptsHTML += renderAttemptBlock(t2, '2ª Tentativa', true);
    attemptsHTML += renderAttemptBlock(t3, '3ª Tentativa', true);

    if (attemptsHTML === '') {
        attemptsHTML = '<div class="pl-4 text-gray-500 italic">Nenhuma tentativa registrada.</div>';
    }

    // Lógica CONDICIONAL para VISITA
    let visitaHTML = '';
    if (visita && visita.id) {
        visitaHTML = `
            <div class="border rounded-md p-3 space-y-3" style="font-family: 'Inter', sans-serif;">
                <h4 class="font-semibold text-base">Visita In Loco</h4>
                <div class="pl-4">
                    <p><strong>Data da Visita:</strong> ${formatDate(visita.visitDate)}</p>
                    <p><strong>Agente Responsável:</strong> ${formatText(visita.visitAgent)}</p>
                    <p><strong>Conseguiu contato?</strong> ${visita.visitSucceeded === 'yes' ? 'Sim' : visita.visitSucceeded === 'no' ? 'Não' : ''}</p>
                    <p><strong>Com quem falou?</strong> ${formatText(visita.visitContactPerson)}</p>
                    <p><strong>Justificativa/Obs:</strong> ${formatText(visita.visitReason)}</p>
                </div>
            </div>`;
    }

    // Lógica CONDICIONAL para ENCAMINHAMENTO
    let encaminhamentoHTML = '';
    if (ct && ct.oficioNumber) {
        encaminhamentoHTML = `
            <p><strong>Nº Ofício CT:</strong> ${formatText(ct.oficioNumber)}/${formatText(ct.oficioYear)}</p>
            <p><strong>Devolutiva:</strong> ${formatText(ct.ctFeedback)}</p>
        `;
    } else {
        encaminhamentoHTML = `<p class="italic text-gray-500">Não houve encaminhamento ao Conselho Tutelar neste processo.</p>`;
    }

    const fichaHTML = `
        <div class="space-y-4 text-sm" style="font-family: 'Times New Roman', serif; line-height: 1.5;">
            ${getReportHeaderHTML()}
            <h3 class="font-semibold mt-1 text-center uppercase">Ficha de Acompanhamento da Busca Ativa</h3>
             <p class="text-xs text-gray-500 text-center">ID do Processo: ${currentProcessId}</p>

            <div class="border rounded-md p-3" style="font-family: 'Inter', sans-serif;">
                <h4 class="font-semibold text-base mb-2">Identificação</h4>
                <p><strong>Nome do aluno:</strong> ${studentData.name}</p>
                <p><strong>Ano/Ciclo:</strong> ${studentData.class || ''}</p>
                <p><strong>Endereço:</strong> ${formatText(studentData.endereco)}</p>
                <p><strong>Contato:</strong> ${formatText(studentData.contato)}</p>
                <p><strong>Responsáveis:</strong> ${[studentData.resp1, studentData.resp2].filter(Boolean).join(' / ') || 'Não informado'}</p>
            </div>

            <div class="border rounded-md p-3" style="font-family: 'Inter', sans-serif;">
                <h4 class="font-semibold text-base mb-2">Faltas apuradas no período de:</h4>
                <p><strong>Data de início:</strong> ${formatDate(faltasData.periodoFaltasStart)}</p>
                <p><strong>Data de fim:</strong> ${formatDate(faltasData.periodoFaltasEnd)}</p>
                <p><strong>Nº de faltas:</strong> ${formatText(faltasData.absenceCount)}</p>
            </div>

            <div class="border rounded-md p-3 space-y-3" style="font-family: 'Inter', sans-serif;">
                <h4 class="font-semibold text-base">Tentativas de contato</h4>
                ${attemptsHTML}
            </div>

            ${visitaHTML}

            <div class="border rounded-md p-3 space-y-2" style="font-family: 'Inter', sans-serif;">
                <h4 class="font-semibold text-base">Encaminhamento e Análise</h4>
                ${encaminhamentoHTML}
                <div class="mt-2 border-t pt-2">
                    <p><strong>Parecer da BAE / Desfecho:</strong> ${formatText(analise.ctParecer)}</p>
                </div>
            </div>

            <div class="signature-block mt-8 space-y-12">
                <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Diretor(a)</p></div>
                <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Coordenador(a) Pedagógico(a)</p></div>
            </div>
        </div>`;
    document.getElementById('report-view-title').textContent = "Ficha Consolidada de Busca Ativa";
    document.getElementById('report-view-content').innerHTML = fichaHTML;
    openModal(dom.reportViewModalBackdrop);
};

/**
 * Gera o Ofício para o Conselho Tutelar (Busca Ativa).
 */
export const generateAndShowOficio = async (action, oficioNumber = null) => {
    if (!action) return showToast('Ação de origem não encontrada.');

    const finalOficioNumber = oficioNumber || action.oficioNumber;
    const finalOficioYear = action.oficioYear || new Date().getFullYear();

    if (!finalOficioNumber) return showToast('Número do ofício não fornecido ou não encontrado para este registro.');

    if (!state.students.find(s => s.matricula === action.studentId)) {
        showToast('Buscando dados completos do aluno...');
    }
    const student = await resolveStudentData(action.studentId, action);

    const processActions = state.absences
        .filter(a => a.processId === action.processId)
        .sort((a, b) => (a.createdAt?.seconds || new Date(a.createdAt).getTime()) - (b.createdAt?.seconds || new Date(b.createdAt).getTime()));

    if (processActions.length === 0) return showToast('Nenhuma ação encontrada para este processo.');

    const firstActionWithAbsenceData = processActions.find(a => a.periodoFaltasStart);
    const visitAction = processActions.find(a => a.actionType === 'visita');
    const contactAttempts = processActions.filter(a => a.actionType.startsWith('tentativa'));

    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ') || 'Responsáveis Legais';
    const city = state.config?.city || "Cidade";

    let attemptsSummary = contactAttempts.map((attempt, index) => {
        const attemptDate = attempt.contactDate || attempt.createdAt?.toDate();
        return `
            <p class="ml-4">- <strong>${index + 1}ª Tentativa (${formatDate(attemptDate)}):</strong>
            ${attempt.contactSucceeded === 'yes'
                ? `Contato realizado com ${formatText(attempt.contactPerson)}. Justificativa: ${formatText(attempt.contactReason)}.`
                : 'Não foi possível estabelecer contato.'}
            </p>
        `;
    }).join('');
    if (!attemptsSummary) attemptsSummary = "<p class='ml-4'>Nenhuma tentativa de contato registrada.</p>";

    const formatPeriodoLocal = (start, end) => {
        if (start && end) return `de ${formatDate(start)} a ${formatDate(end)}`;
        if (start) return `a partir de ${formatDate(start)}`;
        if (end) return `até ${formatDate(end)}`;
        return '(não informado)';
    }

    const oficioHTML = `
        <div class="space-y-6 text-sm text-gray-800" style="font-family: 'Times New Roman', serif; line-height: 1.5;">
            <div>${getReportHeaderHTML()}<p class="text-right mt-4">${city}, ${currentDate}.</p></div>
            <div class="mt-8"><p class="font-bold text-base">OFÍCIO Nº ${String(finalOficioNumber).padStart(3, '0')}/${finalOficioYear}</p></div>
            <div class="mt-8"><p><strong>Ao</strong></p><p><strong>Conselho Tutelar</strong></p><p><strong>${city}</strong></p></div>
            <div class="mt-8"><p><strong>Assunto:</strong> Encaminhamento de aluno infrequente.</p></div>
            <div class="mt-8 text-justify">
                <p class="indent-8">Prezados(as) Conselheiros(as),</p>
                <p class="mt-4 indent-8">Encaminhamos a V. Sa. o caso do(a) aluno(a) <strong>${student.name}</strong>, regularmente matriculado(a) na turma <strong>${student.class}</strong> desta Unidade de Ensino, filho(a) de <strong>${formatText(responsaveis)}</strong>, residente no endereço: ${formatText(student.endereco)}.</p>
                <p class="mt-4 indent-8">O(A) referido(a) aluno(a) apresenta um número de <strong>${formatText(firstActionWithAbsenceData?.absenceCount) || '(não informado)'} faltas</strong>, apuradas no período ${formatPeriodoLocal(firstActionWithAbsenceData?.periodoFaltasStart, firstActionWithAbsenceData?.periodoFaltasEnd)}.</p>
                <p class="mt-4 indent-8">Informamos que a escola esgotou as tentativas de contato com a família, conforme descrito abaixo:</p>
                <div class="mt-2" style="font-family: 'Inter', sans-serif;">${attemptsSummary}</div>
                ${visitAction ? `<p class="mt-4 indent-8">Adicionalmente, foi realizada uma visita in loco em <strong>${formatDate(visitAction?.visitDate)}</strong>...</p>` : '<p class="mt-4 indent-8">Não foi registrada visita in loco neste processo.</p>'}
                <p class="mt-4 indent-8">Diante do exposto e considerando o que preceitua o Art. 56 do Estatuto da Criança e do Adolescente (ECA), solicitamos as devidas providências...</p>
            </div>
            <div class="mt-12 text-center"><p>Atenciosamente,</p></div>
            <div class="signature-block mt-8 space-y-12">
                <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Diretor(a)</p></div>
                 <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Coordenador(a) Pedagógico(a)</p></div>
            </div>
        </div>
    `;

    document.getElementById('report-view-title').textContent = `Ofício Nº ${finalOficioNumber}/${finalOficioYear}`;
    document.getElementById('report-view-content').innerHTML = oficioHTML;
    openModal(dom.reportViewModalBackdrop);
};

/**
 * Gera o Ofício para o Conselho Tutelar (baseado em Ocorrência).
 * ATUALIZADO: Inclui as 3 tentativas de convocação.
 */
export const generateAndShowOccurrenceOficio = async (record, studentObj, oficioNumber, oficioYear) => {
    if (!record || !studentObj || !oficioNumber || !oficioYear) {
        return showToast('Dados insuficientes para gerar o ofício.');
    }

    // Toast de carregamento se não tiver cache
    if (!state.students.find(s => s.matricula === studentObj.matricula)) {
        showToast('Buscando dados completos do aluno...');
    }
    
    // Busca segura via resolveStudentData (com timeout e fallback)
    const student = await resolveStudentData(studentObj.matricula, record.studentName ? record : studentObj);

    let studentRole = defaultRole; 
    if (record.participants && Array.isArray(record.participants)) {
        const participantData = record.participants.find(p => p.studentId === student.matricula);
        if (participantData) {
            studentRole = participantData.role;
        }
    }

    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const responsaveis = [student.resp1, student.resp2].filter(Boolean).join(' e ') || 'Responsáveis Legais';
    const city = state.config?.city || "Cidade";

    // GERA RESUMO DAS 3 TENTATIVAS DE CONVOCAÇÃO
    let attemptsSummary = "";
    for (let i = 1; i <= 3; i++) {
        // Nota: Para a 1ª tentativa, usa meetingDate ou meetingDate_1
        const mDate = (i===1) ? (record.meetingDate || record.meetingDate_1) : record['meetingDate_' + i];
        // const mTime = (i===1) ? (record.meetingTime || record.meetingTime_1) : record['meetingTime_' + i];
        const succeeded = record['contactSucceeded_' + i];
        const contactDate = record['contactDate_' + i];
        const providencias = record['providenciasFamilia_' + i];

        if (mDate) {
            let statusText = "Aguardando retorno.";
            if (succeeded === 'yes') {
                statusText = `Responsável compareceu/contato realizado em ${formatDate(contactDate)}. Providências: ${formatText(providencias)}.`;
            } else if (succeeded === 'no') {
                statusText = "Responsável não compareceu / Sem sucesso no contato.";
            }

            attemptsSummary += `<p class="ml-4 mt-1">- <strong>${i}ª Convocação (${formatDate(mDate)}):</strong> ${statusText}</p>`;
        }
    }
    if (!attemptsSummary) attemptsSummary = "<p class='ml-4'>Nenhuma tentativa de convocação registrada até o momento.</p>";


    const oficioHTML = `
        <div class="space-y-6 text-sm text-gray-800" style="font-family: 'Times New Roman', serif; line-height: 1.5;">
            <div>${getReportHeaderHTML()}<p class="text-right mt-4">${city}, ${currentDate}.</p></div>
            <div class="mt-8"><p class="font-bold text-base">OFÍCIO Nº ${String(oficioNumber).padStart(3, '0')}/${oficioYear}</p></div>
            <div class="mt-8"><p><strong>Ao</strong></p><p><strong>Conselho Tutelar</strong></p><p><strong>${city}</strong></p></div>
            <div class="mt-8"><p><strong>Assunto:</strong> Encaminhamento de aluno por ocorrência disciplinar.</p></div>
            <div class="mt-8 text-justify">
                <p class="indent-8">Prezados(as) Conselheiros(as),</p>
                <p class="mt-4 indent-8">Encaminhamos a V. Sa. o caso do(a) aluno(a) <strong>${student.name}</strong>, regularmente matriculado(a) na turma <strong>${student.class}</strong> desta Unidade de Ensino, filho(a) de <strong>${formatText(responsaveis)}</strong>, residente no endereço: ${formatText(student.endereco)}.</p>
                <p class="mt-4 indent-8">O(A) referido(a) aluno(a) esteve envolvido(a) ${studentRole !== defaultRole ? `(identificado como <strong>${studentRole}</strong>)` : ''} em um incidente em <strong>${formatDate(record.date)}</strong>, classificado como <strong>"${formatText(record.occurrenceType)}"</strong>, conforme descrição abaixo:</p>
                <p class="mt-2 p-3 bg-gray-100 border rounded" style="font-family: 'Inter', sans-serif;">${formatText(record.description)}</p>
                <p class="mt-4 indent-8">Informamos que a escola já realizou as seguintes providências imediatas (Ação 1): <strong>${formatText(record.providenciasEscola) || 'Nenhuma providência imediata registrada.'}</strong></p>
                
                <p class="mt-4 indent-8">Além disso, foram realizadas as seguintes tentativas de convocação/diálogo com a família para resolução do caso:</p>
                <div class="mt-2 mb-2" style="font-family: 'Inter', sans-serif;">${attemptsSummary}</div>

                <p class="mt-4 indent-8">Diante do exposto e considerando a necessidade de acompanhamento, solicitamos as devidas providências deste Conselho para garantir o bem-estar e o direito à educação do(a) aluno(a).</p>
            </div>
            <div class="mt-12 text-center"><p>Atenciosamente,</p></div>
            <div class="signature-block mt-8 space-y-12">
                <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Diretor(a)</p></div>
                 <div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1">Coordenador(a) Pedagógico(a)</p></div>
            </div>
        </div>
    `;

    document.getElementById('report-view-title').textContent = `Ofício Nº ${oficioNumber}/${oficioYear}`;
    document.getElementById('report-view-content').innerHTML = oficioHTML;
    openModal(dom.reportViewModalBackdrop);
};

// --- GRÁFICOS (dependem de Chart.js) ---
/**
 * Gera o relatório geral de ocorrências com gráficos.
 * AGORA ESCALÁVEL: Busca dados diretamente do Firestore.
 */
export const generateAndShowGeneralReport = async () => { 
    showToast("Baixando dados do relatório...");
    
    // Obtém filtros atuais
    const { startDate, endDate, status, type } = state.filtersOccurrences;
    const studentFilter = state.filterOccurrences; 

    // --- CORREÇÃO DE ESCALABILIDADE ---
    // Em vez de usar state.occurrences (limitado a 100), buscamos tudo que corresponde aos filtros
    let rawData = [];
    try {
        rawData = await getOccurrencesForReport(startDate, endDate, type);
    } catch (e) {
        showToast("Erro ao baixar dados. Tentando versão local...");
        rawData = state.occurrences; // Fallback
    }

    // Processa os dados brutos usando a lógica existente
    const filteredIncidentsMap = getFilteredOccurrences(rawData, state.filtersOccurrences);
    const filteredIncidents = [...filteredIncidentsMap.values()]; 

    if (filteredIncidents.length === 0) {
        return showToast('Nenhum incidente encontrado para os filtros selecionados.');
    }

    const currentDate = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const totalStudentsSet = new Set(
        filteredIncidents.flatMap(i => 
            [...i.participantsInvolved.values()]
                .filter(p => !studentFilter || (p.student && p.student.name.toLowerCase().includes(studentFilter.toLowerCase())))
                .map(p => p.student.matricula)
        )
    );
    const totalStudents = totalStudentsSet.size;

    const occurrencesByType = filteredIncidents.reduce((acc, incident) => {
        const occType = incident.records?.[0]?.occurrenceType || 'Não especificado';
        acc[occType] = (acc[occType] || 0) + 1;
        return acc;
    }, {});
    const sortedTypes = Object.entries(occurrencesByType).sort((a, b) => b[1] - a[1]);

    const occurrencesByStatus = filteredIncidents.reduce((acc, incident) => {
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
                    <div><p class="text-2xl font-bold text-sky-600">${filteredIncidents.length}</p><p class="text-xs font-medium text-gray-500 uppercase">Total de Incidentes</p></div>
                    <div><p class="text-2xl font-bold text-sky-600">${totalStudents}</p><p class="text-xs font-medium text-gray-500 uppercase">Alunos Envolvidos ${studentFilter ? '(Filtrados)' : ''}</p></div>
                    <div><p class="text-lg font-bold text-sky-600">${sortedTypes.length > 0 ? formatText(sortedTypes[0][0]) : 'N/A'}</p><p class="text-xs font-medium text-gray-500 uppercase">Principal Tipo</p></div>
                </div>
                ${(startDate || endDate || status !== 'all' || type !== 'all' || studentFilter) ? `<div class="mt-4 border-t pt-3 text-xs text-gray-600"><p><strong>Filtros Aplicados:</strong></p><ul class="list-disc list-inside ml-2">${startDate ? `<li>De: <strong>${formatDate(startDate)}</strong></li>` : ''}${endDate ? `<li>Até: <strong>${formatDate(endDate)}</strong></li>` : ''}${status !== 'all' ? `<li>Status: <strong>${status}</strong></li>` : ''}${type !== 'all' ? `<li>Tipo: <strong>${formatText(type)}</strong></li>` : ''}${studentFilter ? `<li>Aluno: <strong>"${formatText(studentFilter)}"</strong></li>` : ''}</ul></div>` : ''}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 break-inside-avoid">
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
                ${filteredIncidents.sort((a,b) => (b.records?.[0]?.date || 0) - (a.records?.[0]?.date || 0)).map(incident => { 
                    const mainRecord = incident.records?.[0]; 
                    if (!mainRecord) return ''; 
                    
                    const participantsDetails = [...incident.participantsInvolved.values()]
                        .filter(p => !studentFilter || (p.student && p.student.name.toLowerCase().includes(studentFilter.toLowerCase())))
                        .map(p => {
                             const iconClass = roleIcons[p.role] || roleIcons[defaultRole];
                             return `<span class="inline-flex items-center gap-1 mr-2"><i class="${iconClass} fa-fw"></i>${formatText(p.student.name)} (${p.role})</span>`;
                        }).join(', ');

                    return `
                    <div class="border rounded-lg overflow-hidden break-inside-avoid">
                        <div class="bg-gray-100 p-3 flex justify-between items-center">
                            <div>
                                <p class="font-bold text-gray-800">${formatText(mainRecord.occurrenceType)}</p>
                                <p class="text-xs text-gray-600">Data: ${formatDate(mainRecord.date)} | ID: ${incident.id}</p>
                            </div>
                            ${getStatusBadge(incident.overallStatus)}
                        </div>
                        <div class="p-4 space-y-3">
                            <p><strong>Participantes ${studentFilter ? '(Filtrados)' : ''}:</strong> ${participantsDetails}</p>
                            <div><h5 class="text-xs font-semibold uppercase text-gray-500">Descrição do Fato (Ação 1)</h5><p class="whitespace-pre-wrap text-xs bg-gray-50 p-2 rounded">${formatText(mainRecord.description)}</p></div>

                            ${incident.records
                                .filter(rec => {
                                    const participant = incident.participantsInvolved.get(rec.studentId);
                                    if (studentFilter && participant && !participant.student.name.toLowerCase().includes(studentFilter.toLowerCase())) {
                                        return false;
                                    }
                                    return true;
                                })
                                .map(rec => {
                                const participant = incident.participantsInvolved.get(rec.studentId);
                                // Resiliência para detalhes
                                const studentName = participant ? participant.student.name : (rec.studentName || 'Aluno Removido');
                                
                                let attemptsHtml = '';
                                for (let i = 1; i <= 3; i++) {
                                    const succeeded = rec[`contactSucceeded_${i}`];
                                    const date = rec[`contactDate_${i}`];
                                    const providencias = rec[`providenciasFamilia_${i}`];
                                    
                                    if (succeeded != null) {
                                        attemptsHtml += `<p><strong>Ação 3 (Feedback ${i}ª):</strong> ${succeeded === 'yes' ? 'Sim' : 'Não'} (${formatDate(date)})</p>`;
                                        if (providencias) {
                                            attemptsHtml += `<p class="ml-2 text-gray-500">- Providências: ${formatText(providencias)}</p>`;
                                        }
                                    }
                                    // Mostra agendamento das convocações
                                    const mDate = (i===1) ? (rec.meetingDate || rec.meetingDate_1) : rec[`meetingDate_${i}`];
                                    if (mDate) {
                                         attemptsHtml += `<p><strong>Ação 2 (${i}ª Convocação):</strong> ${formatDate(mDate)}</p>`;
                                    }
                                }

                                return `<div class="text-xs border-t mt-2 pt-2">
                                    <p class="font-bold">${formatText(studentName)} (${rec.statusIndividual || 'Pendente'})</p>
                                    ${attemptsHtml}
                                    ${rec.oficioNumber ? `<p><strong>Ação 4 - Enc. CT:</strong> Ofício ${rec.oficioNumber}/${rec.oficioYear}</p>` : ''}
                                    <p><strong>Ação 5 - Devolutiva CT:</strong> ${formatText(rec.ctFeedback)}</p>
                                    <p><strong>Ação 6 - Parecer Final:</strong> ${formatText(rec.parecerFinal)}</p>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>`;
                }).join('')}
                </div>
            </div>

            <div class="signature-block mt-8"><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1 text-sm">Assinatura da Gestão Escolar</p></div></div>
        </div>
    `;

    document.getElementById('report-view-title').textContent = "Relatório Geral de Ocorrências";
    document.getElementById('report-view-content').innerHTML = reportHTML;
    openModal(dom.reportViewModalBackdrop);

    setTimeout(() => {
        try {
            const typeCtx = document.getElementById('report-chart-by-type')?.getContext('2d');
            if (typeCtx && typeof Chart !== 'undefined') {
                new Chart(typeCtx, {
                    type: 'bar',
                    data: { labels: chartDataByType.labels, datasets: [{ label: 'Total', data: chartDataByType.data, backgroundColor: '#0284c7' }] },
                    options: { responsive: true, plugins: { legend: { display: false } }, indexAxis: 'y' }
                });
            } 

            const statusCtx = document.getElementById('report-chart-by-status')?.getContext('2d');
             if (statusCtx && typeof Chart !== 'undefined') {
                new Chart(statusCtx, {
                    type: 'doughnut',
                    data: { labels: chartDataByStatus.labels, datasets: [{ data: chartDataByStatus.data, backgroundColor: ['#f59e0b', '#10b981', '#6b7280'] }] },
                    options: { responsive: true }
                });
            } 

            if (typeof Chart === 'undefined') {
                 const chartAreas = document.querySelectorAll('#report-view-content canvas');
                 chartAreas.forEach(canvas => {
                     const parent = canvas.parentElement;
                     if(parent) parent.innerHTML = "<p class='text-center text-red-500 text-xs'>Chart.js não carregado.</p>";
                 });
            }

        } catch (e) {
            console.error("Erro ao renderizar gráficos:", e);
        }
    }, 100);
};


/**
 * Gera o relatório geral de Busca Ativa com gráficos.
 * AGORA ESCALÁVEL: Busca dados diretamente do Firestore.
 */
export const generateAndShowBuscaAtivaReport = async () => {
    showToast("Baixando dados do relatório...");
    
    // --- CORREÇÃO DE ESCALABILIDADE ---
    let absencesData = [];
    try {
        absencesData = await getAbsencesForReport(state.filtersAbsences.startDate, state.filtersAbsences.endDate);
    } catch (e) {
        showToast("Erro ao baixar dados. Tentando versão local...");
        absencesData = state.absences;
    }

    const groupedByProcess = absencesData.reduce((acc, action) => {
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

    // Pré-processamento assíncrono para resolver nomes de alunos
    const processPromises = processes.map(async (proc) => {
        proc.actions.sort((a, b) => (a.createdAt?.seconds || new Date(a.createdAt).getTime()) - (b.createdAt?.seconds || new Date(b.createdAt).getTime()));
        const lastAction = proc.actions[proc.actions.length - 1];
        if (!lastAction) return null;

        // Busca resiliente
        const studentData = await resolveStudentData(proc.studentId, proc.actions[0]);
        
        if (studentFilter && !studentData.name.toLowerCase().includes(studentFilter.toLowerCase())) return null;

        const isConcluded = lastAction.actionType === 'analise';
        if (processStatus === 'in_progress' && isConcluded) return null;
        if (processStatus === 'concluded' && !isConcluded) return null;

        const lastReturnAction = [...proc.actions].reverse().find(a => a.contactReturned != null || a.visitReturned != null || a.ctReturned != null);
        const lastReturnStatusValue = lastReturnAction ? (lastReturnAction.contactReturned ?? lastReturnAction.visitReturned ?? lastReturnAction.ctReturned) : 'pending';

        if (returnStatus === 'returned' && lastReturnStatusValue !== 'yes') return null;
        if (returnStatus === 'not_returned' && lastReturnStatusValue !== 'no') return null;
        const hasDefinitiveReturn = proc.actions.some(a => a.contactReturned === 'yes' || a.contactReturned === 'no' || a.visitReturned === 'yes' || a.visitReturned === 'no' || a.ctReturned === 'yes' || a.ctReturned === 'no');
        if (returnStatus === 'pending' && hasDefinitiveReturn) return null;

        let isPendingContact = false, isPendingFeedback = false;
        if (!isConcluded) {
             isPendingContact = (lastAction.actionType.startsWith('tentativa') && lastAction.contactSucceeded == null) || (lastAction.actionType === 'visita' && lastAction.visitSucceeded == null);
            const ctAction = proc.actions.find(a => a.actionType === 'encaminhamento_ct');
            isPendingFeedback = ctAction && !ctAction.ctFeedback;
        }

        if (pendingAction === 'pending_contact' && !isPendingContact) return null;
        if (pendingAction === 'pending_feedback' && !isPendingFeedback) return null;

        return { proc, studentData, isConcluded, lastAction, isPendingContact, isPendingFeedback, lastReturnStatusValue, hasDefinitiveReturn };
    });

    const results = await Promise.all(processPromises);
    const filteredResults = results.filter(r => r !== null);

    filteredResults.forEach(({ isConcluded, lastReturnStatusValue, hasDefinitiveReturn, isPendingContact, isPendingFeedback }) => {
        if (isConcluded) {
            statusConcluido++;
        } else {
            statusEmAndamento++;
        }

        if (lastReturnStatusValue === 'yes') retornoSim++;
        else if (lastReturnStatusValue === 'no') retornoNao++;
        else if (!hasDefinitiveReturn) retornoPendente++;
        
        if (isPendingContact) pendenteContato++;
        if (isPendingFeedback) pendenteDevolutiva++;
    });

    if (filteredResults.length === 0) {
        return showToast('Nenhum processo encontrado para os filtros selecionados.');
    }

    const chartDataStatus = { labels: ['Em Andamento', 'Concluídos'], data: [statusEmAndamento, statusConcluido] };
    const chartDataRetorno = { labels: ['Retornou', 'Não Retornou', 'Pendente'], data: [retornoSim, retornoNao, retornoPendente] };
    const chartDataPendente = { labels: ['Aguard. Contato', 'Aguard. Devolutiva CT'], data: [pendenteContato, pendenteDevolutiva] };

     const filterDescriptions = [];
     if(processStatus !== 'all') filterDescriptions.push(`Status: ${processStatus === 'in_progress' ? 'Em Andamento' : 'Concluído'}`);
     if(pendingAction !== 'all') filterDescriptions.push(`Pendente: ${pendingAction === 'pending_contact' ? 'Contato' : 'Devolutiva CT'}`);
     if(returnStatus !== 'all') filterDescriptions.push(`Retorno: ${returnStatus === 'returned' ? 'Retornou' : (returnStatus === 'not_returned' ? 'Não Retornou' : 'Pendente')}`);
     if(studentFilter) filterDescriptions.push(`Aluno: "${formatText(studentFilter)}"`);


    const reportHTML = `
        <div class="space-y-8 text-sm font-sans">
            ${getReportHeaderHTML()}
            <h3 class="text-xl font-semibold text-gray-700 mt-2 text-center">Relatório Geral de Busca Ativa</h3>
            <p class="text-gray-500 mt-1 text-center">Gerado em: ${currentDate}</p>

            <div class="border rounded-lg p-4 bg-gray-50">
                <h4 class="font-semibold text-base mb-3 text-gray-700 border-b pb-2">Resumo do Período</h4>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
                    <div><p class="text-2xl font-bold text-sky-600">${filteredResults.length}</p><p class="text-xs font-medium text-gray-500 uppercase">Processos Filtrados</p></div>
                    <div><p class="text-2xl font-bold text-sky-600">${statusEmAndamento}</p><p class="text-xs font-medium text-gray-500 uppercase">Em Andamento</p></div>
                    <div><p class="text-2xl font-bold text-sky-600">${retornoSim}</p><p class="text-xs font-medium text-gray-500 uppercase">Alunos Retornaram</p></div>
                </div>
                 ${filterDescriptions.length > 0 ? `<div class="mt-4 border-t pt-3 text-xs text-gray-600"><p><strong>Filtros Aplicados:</strong> ${filterDescriptions.join('; ')}</p></div>` : ''}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 break-inside-avoid">
                <div class="border rounded-lg p-4 shadow-sm bg-white"><h5 class="font-semibold text-center mb-2">Status dos Processos</h5><canvas id="ba-chart-status"></canvas></div>
                <div class="border rounded-lg p-4 shadow-sm bg-white"><h5 class="font-semibold text-center mb-2">Status de Retorno</h5><canvas id="ba-chart-retorno"></canvas></div>
                <div class="border rounded-lg p-4 shadow-sm bg-white"><h5 class="font-semibold text-center mb-2">Ações Pendentes (Em Andamento)</h5><canvas id="ba-chart-pendente"></canvas></div>
            </div>

            <div>
                <h4 class="font-semibold text-base mb-3 text-gray-700 border-b pb-2">Detalhes dos Processos</h4>
                <div class="space-y-4">
                ${filteredResults.sort((a,b) => (b.lastAction.createdAt?.seconds || 0) - (a.lastAction.createdAt?.seconds || 0)).map(({ proc, studentData, isConcluded, lastAction }) => {
                    return `
                    <div class="border rounded-lg overflow-hidden break-inside-avoid">
                        <div class="bg-gray-100 p-3 flex justify-between items-center">
                            <div>
                                <p class="font-bold text-gray-800">${formatText(studentData.name)}</p>
                                <p class="text-xs text-gray-600">Turma: ${formatText(studentData.class || 'N/A')} | ID: ${proc.id}</p>
                            </div>
                            ${isConcluded ? '<span class="text-xs font-bold text-white bg-green-600 px-2 py-1 rounded-full">CONCLUÍDO</span>' : '<span class="text-xs font-bold text-white bg-yellow-600 px-2 py-1 rounded-full">EM ANDAMENTO</span>'}
                        </div>
                        <div class="p-4">
                            <h5 class="text-xs font-semibold uppercase text-gray-500 mb-2">Resumo das Ações (${proc.actions.length})</h5>
                            <ul class="list-disc list-inside text-xs space-y-1">
                                ${proc.actions.map(a => `<li><strong>${formatText(actionDisplayTitles[a.actionType])}</strong> (em ${formatDate(a.createdAt?.toDate())})</li>`).join('')}
                            </ul>
                            ${isConcluded ? `<div class="mt-3 border-t pt-2"><h5 class="text-xs font-semibold uppercase text-gray-500">Parecer Final</h5><p class="text-xs whitespace-pre-wrap">${formatText(lastAction.ctParecer)}</p></div>` : ''}
                        </div>
                    </div>`;
                }).join('')}
                </div>
            </div>

            <div class="signature-block mt-8"><div class="text-center w-2/3 mx-auto"><div class="border-t border-gray-400"></div><p class="mt-1 text-sm">Assinatura da Gestão Escolar</p></div></div>
        </div>
    `;

    document.getElementById('report-view-title').textContent = "Relatório Geral de Busca Ativa";
    document.getElementById('report-view-content').innerHTML = reportHTML;
    openModal(dom.reportViewModalBackdrop);

     setTimeout(() => {
        try {
            const statusCtx = document.getElementById('ba-chart-status')?.getContext('2d');
            if (statusCtx && typeof Chart !== 'undefined') {
                new Chart(statusCtx, {
                    type: 'doughnut',
                    data: { labels: chartDataStatus.labels, datasets: [{ data: chartDataStatus.data, backgroundColor: ['#f59e0b', '#10b981'] }] },
                    options: { responsive: true }
                });
            } 

            const retornoCtx = document.getElementById('ba-chart-retorno')?.getContext('2d');
             if (retornoCtx && typeof Chart !== 'undefined') {
                new Chart(retornoCtx, {
                    type: 'pie',
                    data: { labels: chartDataRetorno.labels, datasets: [{ data: chartDataRetorno.data, backgroundColor: ['#10b981', '#ef4444', '#6b7280'] }] },
                    options: { responsive: true }
                });
             }

             const pendenteCtx = document.getElementById('ba-chart-pendente')?.getContext('2d');
             if (pendenteCtx && typeof Chart !== 'undefined') {
                 new Chart(pendenteCtx, {
                    type: 'bar',
                    data: { labels: chartDataPendente.labels, datasets: [{ label: 'Total', data: chartDataPendente.data, backgroundColor: ['#0ea5e9', '#0d9488'] }] },
                    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
                });
             }

             if (typeof Chart === 'undefined') {
                 const chartAreas = document.querySelectorAll('#report-view-content canvas');
                 chartAreas.forEach(canvas => {
                     const parent = canvas.parentElement;
                     if(parent) parent.innerHTML = "<p class='text-center text-red-500 text-xs'>Chart.js não carregado.</p>";
                 });
             }

        } catch (e) {
            console.error("Erro ao renderizar gráficos da Busca Ativa:", e);
        }
    }, 100);
};
