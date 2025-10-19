// ARQUIVO: main.js
// RESPONSABILIDADE: Ponto de entrada da aplicação. Orquestra todos os outros
// módulos, configura os listeners de eventos e a autenticação do usuário.

// --- Importações dos Módulos ---

// Serviços do Firebase para autenticação e banco de dados
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Módulos internos da aplicação
import { auth, db } from './firebase.js'; // Configuração do Firebase
import { state, dom } from './state.js'; // Estado global e elementos do DOM
import { showToast, closeModal, shareContent } from './utils.js'; // Funções utilitárias
import { loadStudents, getCollectionRef, addRecord, updateRecord, deleteRecord, getStudentsDocRef } from './firestore.js'; // Interação com o Firestore
import { 
    render, 
    renderStudentsList, 
    openOccurrenceModalForStudent,
    handleNewAbsenceAction,
    setupAutocomplete,
    openNotificationModal,
    openFichaViewModal,
    generateAndShowReport,
    generateAndShowConsolidatedFicha,
    generateAndShowOficio,
    openAbsenceModalForStudent,
    showLoginView,
    showRegisterView,
    resetStudentForm,
    toggleFamilyContactFields,
    toggleVisitContactFields,
    generateAndShowGeneralReport
} from './ui.js'; // Funções de interface do usuário
import * as logic from './logic.js'; // Lógica de negócio

// --- INICIALIZAÇÃO DA APLICAÇÃO ---

// Evento que dispara quando o HTML da página foi completamente carregado
document.addEventListener('DOMContentLoaded', () => {
    
    state.db = db; // Armazena a instância do banco de dados no estado global

    // Observador do estado de autenticação do Firebase
    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners(); // Garante que listeners antigos sejam removidos ao trocar de usuário
        
        if (user) {
            // Se o usuário está LOGADO
            state.userId = user.uid;
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            dom.loginScreen.classList.add('hidden'); // Esconde a tela de login
            dom.mainContent.classList.remove('hidden'); // Mostra o conteúdo principal
            dom.userProfile.classList.remove('hidden');
            
            try {
                await loadStudents(); // Carrega a lista de alunos do Firestore
                renderStudentsList(); // Renderiza a lista de alunos no modal de gerenciamento
                setupFirestoreListeners(); // Ativa os listeners para ouvir mudanças no banco em tempo real
            } catch (error) {
                showToast(error.message);
            }

        } else {
            // Se o usuário está DESLOGADO
            state.userId = null;
            state.students = [];
            state.occurrences = [];
            state.absences = [];
            render(); // Limpa a tela
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
        }
    });

    // --- Formulários de Autenticação ---

    dom.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            console.error("Erro ao entrar:", error.code);
            showToast("Email ou senha inválidos.");
        }
    });

    dom.registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        try {
            await createUserWithEmailAndPassword(auth, email, password);
        } catch (error) {
            console.error("Erro ao registar:", error.code);
            const message = error.code === 'auth/email-already-in-use' ? "Este email já está a ser utilizado."
                          : error.code === 'auth/weak-password' ? "A sua senha é muito fraca."
                          : "Erro ao criar a conta.";
            showToast(message);
        }
    });

    dom.logoutBtn.addEventListener('click', () => signOut(auth).catch(error => console.error("Erro ao sair:", error)));

    // Configuração de todos os outros eventos da página
    setupEventListeners();
    
    // Configuração dos campos de busca com autocompletar
    setupAutocomplete('search-occurrences', 'occurrence-student-suggestions', openOccurrenceModalForStudent); 
    setupAutocomplete('search-absences', 'absence-student-suggestions', handleNewAbsenceAction);
});


// --- LISTENERS DO FIREBASE (SINCRONIZAÇÃO EM TEMPO REAL) ---

function setupFirestoreListeners() {
    if (!state.userId) return;

    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    const occurrencesQuery = query(getCollectionRef('occurrence'));
    state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') render();
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    const absencesQuery = query(getCollectionRef('absence'));
    state.unsubscribeAbsences = onSnapshot(absencesQuery, (snapshot) => {
        state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'absences') render();
    }, (error) => console.error("Erro ao buscar ações:", error));
};

function detachFirestoreListeners() {
    if (state.unsubscribeOccurrences) state.unsubscribeOccurrences();
    if (state.unsubscribeAbsences) state.unsubscribeAbsences();
    state.unsubscribeOccurrences = null;
    state.unsubscribeAbsences = null;
};


// --- CONFIGURAÇÃO DE EVENTOS DA UI (CLICKS, SUBMITS, ETC.) ---

function setupEventListeners() {
    // --- Navegação e Abas ---
    dom.showRegisterViewBtn.addEventListener('click', showRegisterView);
    dom.showLoginViewBtn.addEventListener('click', showLoginView);
    dom.tabOccurrences.addEventListener('click', () => {
        state.activeTab = 'occurrences';
        dom.tabOccurrences.classList.add('tab-active');
        dom.tabAbsences.classList.remove('tab-active');
        dom.tabContentOccurrences.classList.remove('hidden');
        dom.tabContentAbsences.classList.add('hidden');
        render();
    });
    dom.tabAbsences.addEventListener('click', () => {
        state.activeTab = 'absences';
        dom.tabAbsences.classList.add('tab-active');
        dom.tabOccurrences.classList.remove('tab-active');
        dom.tabContentAbsences.classList.remove('hidden');
        dom.tabContentOccurrences.classList.add('hidden');
        render();
    });

    // --- Ações de Compartilhar e Imprimir ---
    document.getElementById('share-btn').addEventListener('click', () => shareContent(document.getElementById('notification-title').textContent, document.getElementById('notification-content').innerText));
    document.getElementById('report-share-btn').addEventListener('click', () => shareContent(document.getElementById('report-view-title').textContent, document.getElementById('report-view-content').innerText));
    document.getElementById('ficha-share-btn').addEventListener('click', () => shareContent(document.getElementById('ficha-view-title').textContent, document.getElementById('ficha-view-content').innerText));
    document.getElementById('print-btn').addEventListener('click', () => window.print());
    document.getElementById('report-print-btn').addEventListener('click', () => window.print());
    document.getElementById('ficha-print-btn').addEventListener('click', () => window.print());

    // --- Fechamento de Modais ---
    ['close-modal-btn', 'cancel-btn'].forEach(id => document.getElementById(id)?.addEventListener('click', () => closeModal(dom.occurrenceModal)));
    ['close-absence-modal-btn', 'cancel-absence-btn'].forEach(id => document.getElementById(id)?.addEventListener('click', () => closeModal(dom.absenceModal)));
    ['close-report-generator-btn', 'cancel-report-generator-btn'].forEach(id => document.getElementById(id)?.addEventListener('click', () => closeModal(dom.reportGeneratorModal)));
    document.getElementById('close-notification-btn')?.addEventListener('click', () => closeModal(dom.notificationModalBackdrop));
    document.getElementById('close-report-view-btn')?.addEventListener('click', () => closeModal(dom.reportViewModalBackdrop));
    document.getElementById('close-ficha-view-btn')?.addEventListener('click', () => closeModal(dom.fichaViewModalBackdrop));
    document.getElementById('cancel-delete-btn')?.addEventListener('click', () => closeModal(dom.deleteConfirmModal));

    // --- Filtros ---
    dom.occurrenceStartDate.addEventListener('change', (e) => { state.filtersOccurrences.startDate = e.target.value; render(); });
    dom.occurrenceEndDate.addEventListener('change', (e) => { state.filtersOccurrences.endDate = e.target.value; render(); });
    document.getElementById('filter-process-status').addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; render(); });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; render(); });
    document.getElementById('filter-return-status').addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; render(); });
    
    // --- Botão Relatório Geral ---
    dom.generalReportBtn.addEventListener('click', generateAndShowGeneralReport);

    // --- Formulário de Ocorrência (Salvar/Editar) ---
    dom.occurrenceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('occurrence-id').value;
        const studentName = document.getElementById('student-name').value.trim();
        const student = state.students.find(s => s.name === studentName);
        if (!student) return showToast("Aluno inválido. Por favor, selecione um aluno da lista.");
        
        const data = { 
            studentId: student.matricula,
            date: document.getElementById('occurrence-date').value, 
            occurrenceType: document.getElementById('occurrence-type').value,
            description: document.getElementById('description').value.trim(), 
            involved: document.getElementById('involved').value.trim(), 
            actionsTakenSchool: document.getElementById('actions-taken-school').value.trim(), 
            actionsTakenFamily: document.getElementById('actions-taken-family').value.trim(), 
            meetingDate: document.getElementById('meeting-date-occurrence').value || null, 
            meetingTime: document.getElementById('meeting-time-occurrence').value || null
        };
        try { 
            await (id ? updateRecord('occurrence', id, data) : addRecord('occurrence', data)); 
            showToast(`Ocorrência ${id ? 'atualizada' : 'registada'} com sucesso!`); 
            closeModal(dom.occurrenceModal); 
        } catch (error) { console.error("Erro:", error); showToast('Erro ao salvar.'); }
    });

    // --- Formulário de Busca Ativa (Salvar/Editar) ---
    dom.absenceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        if (!form.checkValidity()) {
            form.reportValidity();
            return showToast('Por favor, preencha todos os campos obrigatórios.');
        }
        
        const id = document.getElementById('absence-id').value;
        const studentName = document.getElementById('absence-student-name').value.trim();
        const student = state.students.find(s => s.name === studentName);
        if (!student) return showToast("Aluno inválido.");
        
        const actionType = document.getElementById('action-type').value;
        const processId = document.getElementById('absence-process-id').value;
        const data = { studentId: student.matricula, actionType, processId };

        data.periodoFaltasStart = document.getElementById('absence-start-date').value || null;
        data.periodoFaltasEnd = document.getElementById('absence-end-date').value || null;
        data.absenceCount = document.getElementById('absence-count').value || null;

        if (actionType.startsWith('tentativa')) {
            data.meetingDate = document.getElementById('meeting-date').value || null;
            data.meetingTime = document.getElementById('meeting-time').value || null;
            const contactSucceededRadio = document.querySelector('input[name="contact-succeeded"]:checked');
            data.contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;
            if (data.contactSucceeded === 'yes') {
                data.contactDate = document.getElementById('contact-date').value || null;
                data.contactPerson = document.getElementById('contact-person').value || null;
                data.contactReason = document.getElementById('contact-reason').value || null;
            }
            const contactReturnedRadio = document.querySelector('input[name="contact-returned"]:checked');
            data.contactReturned = contactReturnedRadio ? contactReturnedRadio.value : null;
        } else if (actionType === 'visita') {
            data.visitAgent = document.getElementById('visit-agent').value || null;
            data.visitDate = document.getElementById('visit-date').value || null;
            const visitSucceededRadio = document.querySelector('input[name="visit-succeeded"]:checked');
            data.visitSucceeded = visitSucceededRadio ? visitSucceededRadio.value : null;
             if (data.visitSucceeded === 'yes') {
                data.visitContactPerson = document.getElementById('visit-contact-person').value || null;
                data.visitReason = document.getElementById('visit-reason').value || null;
                data.visitObs = document.getElementById('visit-obs').value || null;
            }
            const visitRadio = document.querySelector('input[name="visit-returned"]:checked');
            data.visitReturned = visitRadio ? visitRadio.value : null;
        } else if (actionType === 'encaminhamento_ct') {
            data.ctSentDate = document.getElementById('ct-sent-date').value || null;
            data.ctFeedback = document.getElementById('ct-feedback').value || null;
            const ctRadio = document.querySelector('input[name="ct-returned"]:checked');
            data.ctReturned = ctRadio ? ctRadio.value : null;
        } else if (actionType === 'analise') {
            data.ctParecer = document.getElementById('ct-parecer').value || null;
        }

        try {
            await (id ? updateRecord('absence', id, data) : addRecord('absence', data));
            showToast(`Ação ${id ? 'atualizada' : 'registada'} com sucesso!`);
            closeModal(dom.absenceModal);
            
            const studentReturned = data.contactReturned === 'yes' || data.visitReturned === 'yes';
            if (studentReturned) {
                setTimeout(() => openAbsenceModalForStudent(student, 'analise'), 350);
            }
        } catch (error) { 
            console.error("Erro ao salvar ação:", error); 
            showToast('Erro ao salvar.'); 
        }
    });
    
    // --- LÓGICA DE CLIQUE NAS LISTAS (DELEGAÇÃO DE EVENTOS) ---
    setupListClickListeners();

    // --- Modal de Confirmação de Exclusão ---
    document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
        if (!state.recordToDelete) return;
        try {
            if (state.recordToDelete.type === 'absence-cascade') {
                const batch = writeBatch(db);
                batch.delete(doc(getCollectionRef('absence'), state.recordToDelete.ctId));
                if (state.recordToDelete.analiseId) {
                    batch.delete(doc(getCollectionRef('absence'), state.recordToDelete.analiseId));
                }
                await batch.commit();
                showToast('Encaminhamento e Análise foram excluídos.');
            } else {
                await deleteRecord(state.recordToDelete.type, state.recordToDelete.id);
                showToast('Registro excluído com sucesso.');
            }
        } catch (error) {
            console.error("Erro ao excluir:", error);
            showToast('Erro ao excluir.');
        } finally {
            state.recordToDelete = null;
            closeModal(dom.deleteConfirmModal);
        }
    });
    
    // --- Modal Gerador de Relatório Individual ---
    document.getElementById('create-report-btn').addEventListener('click', () => {
        const selectedStudentId = document.getElementById('student-select').value;
        if (!selectedStudentId) return showToast('Por favor, selecione um aluno.');
        const reportType = dom.reportGeneratorModal.dataset.reportType;
        if (reportType === 'occurrences') generateAndShowReport(selectedStudentId);
        else generateAndShowConsolidatedFicha(selectedStudentId);
        closeModal(dom.reportGeneratorModal);
    });

    // --- Campos Dinâmicos do Modal de Busca Ativa ---
    document.getElementById('action-type').addEventListener('change', (e) => {
        const action = e.target.value;
        document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));
        const groupToShow = action.startsWith('tentativa') ? 'group-tentativas' : `group-${action}`;
        const groupElement = document.getElementById(groupToShow);
        if (groupElement) groupElement.classList.remove('hidden');
    });
    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'))));
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'))));

    // --- Modal de Gerenciamento de Alunos ---
    document.getElementById('manage-students-btn').addEventListener('click', () => { renderStudentsList(); openModal(dom.studentsModal); });
    document.getElementById('close-students-modal-btn').addEventListener('click', () => closeModal(dom.studentsModal));
    
    // --- Upload de CSV ---
    document.getElementById('upload-csv-btn').addEventListener('click', () => {
        const fileInput = document.getElementById('csv-file');
        const feedbackDiv = document.getElementById('csv-feedback');
        if (fileInput.files.length === 0) return showToast("Por favor, selecione um ficheiro CSV.");
        
        Papa.parse(fileInput.files[0], {
            header: true,
            skipEmptyLines: true,
            transformHeader: header => header.toLowerCase().trim().replace(/\s+/g, ''),
            complete: async (results) => {
                const requiredHeaders = ['matricula', 'nome', 'turma', 'endereco', 'contato', 'resp1', 'resp2'];
                const hasAllHeaders = requiredHeaders.every(h => results.meta.fields.includes(h));
                if (!hasAllHeaders) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Faltam colunas. O ficheiro CSV deve conter: ${requiredHeaders.join(', ')}.</p>`;
                    return;
                }

                const newStudentList = results.data.map(row => ({
                    matricula: row.matricula || '', name: row.nome || '', class: row.turma || '',
                    endereco: row.endereco || '', contato: row.contato || '',
                    resp1: row.resp1 || '', resp2: row.resp2 || ''
                })).filter(s => s.name && s.matricula);

                try {
                    await setDoc(getStudentsDocRef(), { list: newStudentList });
                    state.students = newStudentList;
                    renderStudentsList();
                    showToast(`${newStudentList.length} alunos importados com sucesso!`);
                    fileInput.value = '';
                    feedbackDiv.innerHTML = '';
                } catch(error) {
                    console.error("Erro ao salvar lista de alunos:", error);
                    showToast("Erro ao salvar a nova lista de alunos.");
                }
            }
        });
    });

    // --- Formulário de Aluno (Adicionar/Editar) ---
    document.getElementById('student-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('student-id-input').value;
        const matricula = document.getElementById('student-matricula-input').value.trim();
        const name = document.getElementById('student-name-input').value.trim();
        if (!matricula || !name) return showToast("Matrícula e Nome são obrigatórios.");
        
        let updatedList = [...state.students];
        const studentData = { 
            matricula, name, 
            class: document.getElementById('student-class-input').value.trim(),
            endereco: document.getElementById('student-endereco-input').value.trim(),
            contato: document.getElementById('student-contato-input').value.trim(),
            resp1: document.getElementById('student-resp1-input').value.trim(),
            resp2: document.getElementById('student-resp2-input').value.trim()
        };
        
        if (id) {
            const index = updatedList.findIndex(s => s.matricula === id);
            if (index > -1) updatedList[index] = studentData;
        } else {
            if (updatedList.some(s => s.matricula === matricula)) return showToast("Erro: Matrícula já existe.");
            updatedList.push(studentData);
        }

        try {
            await setDoc(getStudentsDocRef(), { list: updatedList });
            state.students = updatedList;
            renderStudentsList();
            resetStudentForm();
            showToast(`Aluno ${id ? 'atualizado' : 'adicionado'} com sucesso.`);
        } catch(error) {
            console.error("Erro ao salvar aluno:", error);
            showToast("Erro ao salvar dados do aluno.");
        }
    });

    document.getElementById('cancel-edit-student-btn').addEventListener('click', resetStudentForm);
};

// --- FUNÇÃO CENTRALIZADA PARA LISTENERS DE LISTA ---
// Esta função utiliza 'event delegation' para gerenciar os cliques de forma eficiente.
function setupListClickListeners() {
    
    // Listener para a lista de OCORRÊNCIAS
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const target = e.target;
        const header = target.closest('.process-header');
        
        // A SOLUÇÃO: Em vez de verificar 'e.target', encontramos o <button> mais próximo.
        // Isso funciona mesmo que o usuário clique no ícone <i> dentro do botão.
        const button = target.closest('button');

        if (button) { // Ação prioritária: clique em botão
            e.stopPropagation(); // Impede que o clique se propague para o header (acordeão)
            const id = button.dataset.id;
            const studentId = button.dataset.studentId;

            if (button.classList.contains('edit-btn')) {
                const data = state.occurrences.find(o => o.id === id);
                const student = data ? state.students.find(s => s.matricula === data.studentId) : null;
                if (student) {
                    dom.occurrenceForm.reset();
                    document.getElementById('modal-title').innerText = 'Editar Registro de Ocorrência';
                    document.getElementById('occurrence-id').value = data.id;
                    document.getElementById('student-name').value = student.name;
                    document.getElementById('student-class').value = student.class;
                    document.getElementById('occurrence-type').value = data.occurrenceType || '';
                    document.getElementById('occurrence-date').value = data.date || '';
                    document.getElementById('description').value = data.description || '';
                    document.getElementById('involved').value = data.involved || '';
                    document.getElementById('actions-taken-school').value = data.actionsTakenSchool || '';
                    document.getElementById('actions-taken-family').value = data.actionsTakenFamily || '';
                    document.getElementById('meeting-date-occurrence').value = data.meetingDate || '';
                    document.getElementById('meeting-time-occurrence').value = data.meetingTime || '';
                    openModal(dom.occurrenceModal);
                }
            } else if (button.classList.contains('delete-btn')) {
                document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este registro? Esta ação não pode ser desfeita.';
                state.recordToDelete = { type: 'occurrence', id };
                openModal(dom.deleteConfirmModal);
            } else if (button.classList.contains('view-btn')) {
                openNotificationModal(id);
            } else if (button.classList.contains('generate-student-report-btn')) {
                generateAndShowReport(studentId);
            }
            return;
        }
        
        // Ação secundária: clique no nome do aluno para novo registro
        const newOccurrenceTrigger = target.closest('.new-occurrence-from-history-btn');
        if (newOccurrenceTrigger) {
             e.stopPropagation();
             const studentId = newOccurrenceTrigger.dataset.studentId;
             const student = state.students.find(s => s.matricula === studentId);
             if (student) openOccurrenceModalForStudent(student);
             return;
        }

        // Ação fallback: expandir/recolher o acordeão
        if (header) {
            const studentId = header.dataset.studentIdOcc;
            const content = document.getElementById(`content-occ-${studentId}`);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
                content.style.maxHeight = isHidden ? `${content.scrollHeight}px` : null;
                icon?.classList.toggle('rotate-180', isHidden);
            }
        }
    });

    // Listener para a lista de BUSCA ATIVA (mesma lógica de `closest('button')`)
    dom.absencesListDiv.addEventListener('click', (e) => {
        const target = e.target;
        const header = target.closest('.process-header');
        const button = target.closest('button');

        if (button) {
            e.stopPropagation();
            const id = button.dataset.id;
            
            if (button.classList.contains('edit-absence-btn')) {
                const data = state.absences.find(a => a.id === id);
                const student = data ? state.students.find(s => s.matricula === data.studentId) : null;
                if (student) openAbsenceModalForStudent(student, data.actionType, data);

            } else if (button.classList.contains('delete-absence-btn')) {
                const actionToDelete = state.absences.find(a => a.id === id);
                if (!actionToDelete) return;

                const sequence = ['tentativa_1', 'tentativa_2', 'tentativa_3', 'visita', 'encaminhamento_ct', 'analise'];
                const processActions = state.absences.filter(a => a.processId === actionToDelete.processId);
                const deleteIndex = sequence.indexOf(actionToDelete.actionType);
                const hasLaterAction = processActions.some(a => sequence.indexOf(a.actionType) > deleteIndex);

                if (hasLaterAction) return showToast("Exclua a etapa mais recente do processo primeiro.");
                
                if (actionToDelete.actionType === 'encaminhamento_ct') {
                    const analiseAction = processActions.find(a => a.actionType === 'analise');
                    document.getElementById('delete-confirm-message').textContent = 'A etapa de Análise associada também será excluída. Deseja continuar?';
                    state.recordToDelete = { type: 'absence-cascade', ctId: id, analiseId: analiseAction ? analiseAction.id : null };
                } else {
                    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este registro?';
                    state.recordToDelete = { type: 'absence', id: id };
                }
                openModal(dom.deleteConfirmModal);

            } else if (button.classList.contains('notification-btn')) {
                openFichaViewModal(id);
            } else if (button.classList.contains('send-ct-btn')) {
                const oficioNumber = prompt("Por favor, insira o número do ofício:");
                if (oficioNumber?.trim()) {
                    const visitAction = state.absences.find(a => a.id === id);
                    if (visitAction) {
                        generateAndShowOficio(visitAction, oficioNumber);
                        const student = state.students.find(s => s.matricula === visitAction.studentId);
                        if (!student) return;

                        const { processId, currentCycleActions } = logic.getStudentProcessInfo(student.matricula);
                        if (currentCycleActions.some(a => a.actionType === 'encaminhamento_ct')) return;

                        const firstActionWithAbsenceData = currentCycleActions.find(a => a.periodoFaltasStart);
                        const dataForCtAction = {
                            studentId: student.matricula, actionType: 'encaminhamento_ct', processId,
                            ctSentDate: new Date().toISOString().split('T')[0],
                            oficioNumber, oficioYear: new Date().getFullYear(),
                            periodoFaltasStart: firstActionWithAbsenceData?.periodoFaltasStart || null,
                            periodoFaltasEnd: firstActionWithAbsenceData?.periodoFaltasEnd || null,
                            absenceCount: firstActionWithAbsenceData?.absenceCount || null,
                        };
                        addRecord('absence', dataForCtAction)
                          .then(() => showToast("Registro de 'Encaminhamento ao CT' salvo automaticamente."))
                          .catch(err => showToast("Erro ao salvar o encaminhamento automático."));
                    }
                }
            } else if (button.classList.contains('view-oficio-btn')) {
                const ctAction = state.absences.find(a => a.id === id);
                if (ctAction) generateAndShowOficio(ctAction);
            } else if (button.classList.contains('generate-ficha-btn-row')) {
                generateAndShowConsolidatedFicha(button.dataset.studentId, button.dataset.processId);
            }
            return;
        }

        const newActionTrigger = target.closest('.new-action-from-history-btn');
        if (newActionTrigger) {
            e.stopPropagation();
            const studentId = newActionTrigger.dataset.studentId;
            const student = state.students.find(s => s.matricula === studentId);
            if (student) handleNewAbsenceAction(student);
            return;
        }

        if (header) {
            const processId = header.dataset.processId;
            const content = document.getElementById(`content-${processId}`);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
                content.style.maxHeight = isHidden ? `${content.scrollHeight}px` : null;
                icon?.classList.toggle('rotate-180', isHidden);
            }
        }
    });
}
