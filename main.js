// =================================================================================
// ARQUIVO: main.js
// RESPONSABILIDADE: Ponto de entrada da aplicação. Orquestra a lógica de
// eventos, submissão de formulários e a comunicação entre a UI e o Firestore.
//
// ATUALIZAÇÃO (Baseada no Diálogo):
// 1. (Arquitetura) `handleOccurrenceSubmit` foi REFEITA para salvar apenas os
//    dados COLETIVOS do fato (Data, Tipo, Descrição).
// 2. (Arquitetura) `handleFollowUpSubmit` foi REFEITA para salvar o
//    ACOMPANHAMENTO INDIVIDUAL, que agora inclui:
//    - Convocação para Reunião (Data/Hora)
//    - Contato com a Família (Status, Tipo, Data)
//    - Providências da Escola (Individual)
//    - Providências da Família (Novo campo)
//    - Parecer / Desfecho (Individual)
// 3. (Lógica) O Status do Acompanhamento agora é AUTOMÁTICO, baseado no
//    preenchimento do Parecer e do Contato (Resolvido, Pendente, Aguardando Contato).
// 4. (Bug Fix) Corrigido o botão "Cancelar" do modal de Acompanhamento,
//    adicionando uma referência para ele em `setupModalCloseButtons`.
// 5. (Lógica) Atualizada a criação de novos registros para INICIALIZAR os
//    campos movidos (meetingDate, contactSucceeded, etc.) como nulos.
// =================================================================================

// --- MÓDULOS IMPORTADOS ---

// Serviços do Firebase para autenticação e banco de dados
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc, setDoc, where, getDocs, collection, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Módulos internos da aplicação
import { auth, db } from './firebase.js';
// ATUALIZADO: (CORREÇÃO) Importa a nova função de inicialização do DOM.
import { state, dom, initializeDOMReferences } from './state.js';
import { showToast, closeModal, shareContent, openModal } from './utils.js';
// ATUALIZADO: (Arquitetura) Importa `deleteRecord` para exclusão correta.
import { loadStudents, saveSchoolConfig, loadSchoolConfig, getCollectionRef, getStudentsDocRef, getCounterDocRef, updateRecordWithHistory, addRecordWithHistory, deleteRecord } from './firestore.js';
import { 
    render, 
    renderStudentsList, 
    openOccurrenceModal,
    handleNewAbsenceAction,
    setupAutocomplete,
    openStudentSelectionModal,
    openOccurrenceRecordModal,
    openHistoryModal,
    openAbsenceHistoryModal,
    openFichaViewModal,
    generateAndShowConsolidatedFicha,
    generateAndShowOficio,
    openAbsenceModalForStudent,
    showLoginView,
    showRegisterView,
    resetStudentForm,
    toggleFamilyContactFields,
    toggleVisitContactFields,
    generateAndShowGeneralReport,
    generateAndShowBuscaAtivaReport,
    getFilteredOccurrences,
    openSettingsModal,
    // NOVO: (Arquitetura) Importa a nova função para abrir o modal de acompanhamento.
    openFollowUpModal 
} from './ui.js';
import * as logic from './logic.js';

// --- INICIALIZAÇÃO DA APLICAÇÃO ---

document.addEventListener('DOMContentLoaded', () => {
    // NOVO: (CORREÇÃO) Popula as referências do DOM AGORA,
    // garantindo que todos os elementos existem antes de usá-los.
    initializeDOMReferences();

    state.db = db; // Armazena a instância do DB no estado global

    // Observador do estado de autenticação do Firebase
    onAuthStateChanged(auth, async user => {
        detachFirestoreListeners(); // Limpa listeners antigos para evitar duplicação
        
        if (user) {
            // Utilizador AUTENTICADO
            state.userId = user.uid;
            state.userEmail = user.email;
            dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;
            
            dom.loginScreen.classList.add('hidden');
            dom.mainContent.classList.remove('hidden');
            dom.userProfile.classList.remove('hidden');
            
            try {
                // Carrega dados essenciais
                await loadSchoolConfig(); 
                await loadStudents();
                dom.headerSchoolName.textContent = state.config.schoolName || 'Sistema de Acompanhamento';
                setupFirestoreListeners();
                render();
            } catch (error) {
                showToast(error.message);
            }
        } else {
            // Utilizador NÃO AUTENTICADO
            state.userId = null;
            state.userEmail = null;
            state.students = [];
            state.occurrences = [];
            state.absences = [];
            
            dom.mainContent.classList.add('hidden');
            dom.userProfile.classList.add('hidden');
            dom.loginScreen.classList.remove('hidden');
            render();
        }
    });

    // ATUALIZADO: (CORREÇÃO) Movido para ser chamado DEPOIS de initializeDOMReferences()
    setupEventListeners();
    
    // Configura autocomplete apenas para a Busca Ativa.
    setupAutocomplete('search-absences', 'absence-student-suggestions', handleNewAbsenceAction);
});

// --- SINCRONIZAÇÃO COM O BANCO DE DADOS (FIRESTORE) ---

function setupFirestoreListeners() {
    if (!state.userId) return;

    const occurrencesQuery = query(getCollectionRef('occurrence'));
    state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
        state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (state.activeTab === 'occurrences') render();
    }, (error) => console.error("Erro ao buscar ocorrências:", error));

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

// --- CONFIGURAÇÃO CENTRAL DE EVENTOS DA UI ---

function setupEventListeners() {
    // Autenticação
    dom.loginForm.addEventListener('submit', handleLogin);
    dom.registerForm.addEventListener('submit', handleRegister);
    dom.logoutBtn.addEventListener('click', () => signOut(auth));
    dom.showRegisterViewBtn.addEventListener('click', showRegisterView);
    dom.showLoginViewBtn.addEventListener('click', showLoginView);
    
    // Navegação por Abas
    dom.tabOccurrences.addEventListener('click', () => switchTab('occurrences'));
    dom.tabAbsences.addEventListener('click', () => switchTab('absences'));

    // Submissão de Formulários
    dom.occurrenceForm.addEventListener('submit', handleOccurrenceSubmit);
    dom.absenceForm.addEventListener('submit', handleAbsenceSubmit);
    dom.settingsForm.addEventListener('submit', handleSettingsSubmit);
    // NOVO: (Arquitetura) Listener para o novo formulário de acompanhamento.
    dom.followUpForm.addEventListener('submit', handleFollowUpSubmit);

    // Fechar Modais
    setupModalCloseButtons();

    // --- Ocorrências: Listeners ---
    document.getElementById('add-occurrence-btn').addEventListener('click', () => openOccurrenceModal());
    dom.searchOccurrences.addEventListener('input', (e) => { state.filterOccurrences = e.target.value; render(); });
    dom.occurrenceStartDate.addEventListener('change', (e) => { state.filtersOccurrences.startDate = e.target.value; render(); });
    dom.occurrenceEndDate.addEventListener('change', (e) => { state.filtersOccurrences.endDate = e.target.value; render(); });
    document.getElementById('occurrence-filter-type').addEventListener('change', (e) => { state.filtersOccurrences.type = e.target.value; render(); });
    document.getElementById('occurrence-filter-status').addEventListener('change', (e) => { state.filtersOccurrences.status = e.target.value; render(); });
    dom.generalReportBtn.addEventListener('click', generateAndShowGeneralReport);
    // REMOVIDO: O listener de 'occurrence-contact-succeeded' foi movido para o modal de Acompanhamento (e será adicionado lá, se necessário)
    // document.querySelectorAll('input[name="occurrence-contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('occurrence-family-contact-fields'))));

    // --- Busca Ativa: Listeners ---
    document.getElementById('general-ba-report-btn').addEventListener('click', generateAndShowBuscaAtivaReport);
    document.getElementById('filter-process-status').addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; render(); });
    document.getElementById('filter-pending-action').addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; render(); });
    document.getElementById('filter-return-status').addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; render(); });
    
    // Gerenciamento de Alunos e Configurações
    document.getElementById('manage-students-btn').addEventListener('click', () => { renderStudentsList(); openModal(dom.studentsModal); });
    document.getElementById('upload-csv-btn').addEventListener('click', handleCsvUpload);
    document.getElementById('student-form').addEventListener('submit', handleStudentFormSubmit);
    document.getElementById('cancel-edit-student-btn').addEventListener('click', resetStudentForm);
    dom.settingsBtn.addEventListener('click', openSettingsModal);


    // Ações nas Listas
    setupListClickListeners();

    // NOVO: (Otimização) Listener centralizado para a tabela de alunos.
    dom.studentsListTable.addEventListener('click', handleStudentTableActions);

    // Ações em Modais
    document.getElementById('confirm-delete-btn').addEventListener('click', handleDeleteConfirmation);
    document.getElementById('action-type').addEventListener('change', (e) => handleActionTypeChange(e.target.value));
    document.querySelectorAll('input[name="contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('family-contact-fields'))));
    document.querySelectorAll('input[name="visit-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', document.getElementById('visit-contact-fields'))));
    
    // NOVO: (Arquitetura) Listener para o rádio de contato no modal de ACOMPANHAMENTO.
    // Assumindo que o `index.html` será atualizado para ter estes rádios com este 'name'.
    document.querySelectorAll('input[name="follow-up-contact-succeeded"]').forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', document.getElementById('follow-up-family-contact-fields'))));


    document.addEventListener('click', (e) => {
        if (!e.target.closest('.kebab-menu-container')) {
            document.querySelectorAll('.kebab-menu-dropdown').forEach(d => d.classList.add('hidden'));
        }
    });
}

// --- HANDLERS E FUNÇÕES AUXILIARES ---

// Funções de Autenticação
async function handleLogin(e) { 
    e.preventDefault(); 
    try { 
        // (Correção de Bug Anterior) Usa getElementById para garantir que o elemento existe no momento do submit.
        await signInWithEmailAndPassword(auth, document.getElementById('login-email').value, document.getElementById('login-password').value); 
    } catch (error) { 
        console.error("Erro de Login:", error); 
        showToast("Email ou senha inválidos."); 
    } 
}
async function handleRegister(e) { 
    e.preventDefault(); 
    try { 
        // (Correção de Bug Anterior) Usa getElementById.
        await createUserWithEmailAndPassword(auth, document.getElementById('register-email').value, document.getElementById('register-password').value); 
    } catch (error) { 
        console.error("Erro de Registo:", error); 
        showToast(getAuthErrorMessage(error.code));
    }
}

function getAuthErrorMessage(code) {
    switch (code) {
        case 'auth/email-already-in-use': return "Este email já está a ser utilizado.";
        case 'auth/weak-password': return "A sua senha é muito fraca.";
        default: return "Erro ao criar a conta.";
    }
}

// NOVO: (Melhoria) Função para traduzir erros do Firestore.
function getFirestoreErrorMessage(code) {
    switch (code) {
        case 'permission-denied':
            return "Permissão negada. Verifique as suas credenciais.";
        case 'not-found':
            return "Documento não encontrado.";
        default:
            return "Ocorreu um erro na operação com a base de dados.";
    }
}


function switchTab(tabName) {
    state.activeTab = tabName;
    const isOccurrences = tabName === 'occurrences';
    dom.tabOccurrences.classList.toggle('tab-active', isOccurrences);
    dom.tabAbsences.classList.toggle('tab-active', !isOccurrences);
    dom.tabContentOccurrences.classList.toggle('hidden', !isOccurrences);
    dom.tabContentAbsences.classList.toggle('hidden', isOccurrences);
    render();
}

/**
 * ATUALIZADO: (Arquitetura) Lida com a submissão do formulário de ocorrências (criação ou edição do FATO COLETIVO).
 * REMOVIDOS os campos de Convocação e Contato.
 */
async function handleOccurrenceSubmit(e) {
    e.preventDefault();
    const groupId = document.getElementById('occurrence-group-id').value;
    
    if (state.selectedStudents.size === 0) {
        return showToast("Selecione pelo menos um aluno.");
    }
    
    // REMOVIDO: O 'contactSucceededRadio' foi movido para o handleFollowUpSubmit.

    // ATUALIZADO: (Arquitetura) Apenas dados coletivos são recolhidos deste formulário.
    const collectiveData = { 
        date: document.getElementById('occurrence-date').value, 
        occurrenceType: document.getElementById('occurrence-type').value,
        description: document.getElementById('description').value.trim(), 
        // REMOVIDO: meetingDate
        // REMOVIDO: meetingTime
        // REMOVIDO: contactSucceeded
        // REMOVIDO: contactType
        // REMOVIDO: contactDate
    };

    try { 
        if (groupId) {
            // --- MODO DE EDIÇÃO DO FATO ---
            const originalIncident = getFilteredOccurrences().get(groupId);
            if (!originalIncident) throw new Error("Incidente original não encontrado.");

            const historyAction = "Dados gerais do fato foram atualizados.";
            const batch = writeBatch(db);
            const studentIdsInvolved = [...state.selectedStudents.keys()];

            // Atualiza os dados coletivos para todos os alunos que PERMANECEM no incidente.
            originalIncident.records.forEach(record => {
                if (studentIdsInvolved.includes(record.studentId)) {
                    const recordRef = doc(getCollectionRef('occurrence'), record.id);
                    batch.update(recordRef, collectiveData);
                }
            });

            // Adiciona alunos novos ao incidente.
            for (const studentId of studentIdsInvolved) {
                const isNewStudent = !originalIncident.records.some(r => r.studentId === studentId);
                if (isNewStudent) {
                    const newRecordRef = doc(collection(db, getCollectionRef('occurrence').path));
                    const templateRecord = originalIncident.records[0] || {};
                    
                    // ATUALIZADO: (Arquitetura) Novos registros individuais são inicializados com todos os campos (nulos).
                    const newRecordData = { 
                        ...collectiveData, 
                        studentId, 
                        occurrenceGroupId: groupId,
                        // NOVO: (Arquitetura) Campos individuais são inicializados.
                        statusIndividual: 'Aguardando Contato', // Novo status padrão
                        schoolActionsIndividual: '',
                        providenciasFamilia: '', // Campo novo
                        parecerIndividual: '',
                        meetingDate: null, // Campo movido
                        meetingTime: null, // Campo movido
                        contactSucceeded: null, // Campo movido
                        contactType: null, // Campo movido
                        contactDate: null, // Campo movido
                        // Fim dos campos individuais
                        history: templateRecord.history || [], // Herda histórico
                        createdAt: new Date(),
                        createdBy: state.userEmail
                    };
                    batch.set(newRecordRef, newRecordData);
                }
            }

            // Deleta registros de alunos que foram REMOVIDOS do incidente.
            const removedStudentIds = originalIncident.records
                .map(r => r.studentId)
                .filter(id => !studentIdsInvolved.includes(id));

            for (const studentId of removedStudentIds) {
                const recordToDelete = originalIncident.records.find(r => r.studentId === studentId);
                if (recordToDelete) {
                    batch.delete(doc(getCollectionRef('occurrence'), recordToDelete.id));
                }
            }
            
            // Adiciona a ação ao histórico de todos os registros que permanecerão.
            const recordsToUpdateHistory = await getDocs(query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', groupId)));
            recordsToUpdateHistory.docs.forEach(docSnapshot => {
                 if (studentIdsInvolved.includes(docSnapshot.data().studentId)) {
                    const newHistoryEntry = { action: historyAction, user: state.userEmail, timestamp: new Date() };
                    const currentHistory = docSnapshot.data().history || [];
                    batch.update(docSnapshot.ref, { history: [...currentHistory, newHistoryEntry] });
                 }
            });

            await batch.commit();
            showToast('Fato da ocorrência atualizado com sucesso!');

        } else {
            // --- MODO DE CRIAÇÃO ---
            const counterRef = getCounterDocRef('occurrences');
            const newGroupId = await runTransaction(db, async (transaction) => {
                const counterDoc = await transaction.get(counterRef);
                const currentYear = new Date().getFullYear();
                let newCount = 1;
                if (counterDoc.exists() && counterDoc.data().year === currentYear) {
                    newCount = counterDoc.data().count + 1;
                }
                transaction.set(counterRef, { count: newCount, year: currentYear });
                return `OCC-${currentYear}-${String(newCount).padStart(3, '0')}`;
            });

            for (const studentId of state.selectedStudents.keys()) {
                // ATUALIZADO: (Arquitetura) Novos registros individuais são inicializados com todos os campos (nulos).
                const recordData = { 
                    ...collectiveData, 
                    studentId,
                    occurrenceGroupId: newGroupId,
                    // NOVO: (Arquitetura) Campos individuais são inicializados aqui.
                    statusIndividual: 'Aguardando Contato', // Novo status padrão
                    schoolActionsIndividual: '',
                    providenciasFamilia: '', // Campo novo
                    parecerIndividual: '',
                    meetingDate: null, // Campo movido
                    meetingTime: null, // Campo movido
                    contactSucceeded: null, // Campo movido
                    contactType: null, // Campo movido
                    contactDate: null, // Campo movido
                };
                // A função `addRecordWithHistory` já adiciona o histórico e dados de criação.
                await addRecordWithHistory('occurrence', recordData, 'Incidente registado', state.userEmail);
            }
            showToast(`Ocorrência ${newGroupId} registada com sucesso!`); 
        }
        closeModal(dom.occurrenceModal); 
    } catch (error) { 
        console.error("Erro ao salvar ocorrência:", error);
        // ATUALIZADO: (Melhoria) Mensagem de erro mais específica.
        showToast(getFirestoreErrorMessage(error.code) || 'Erro ao salvar a ocorrência.'); 
    }
}

/**
 * ATUALIZADO: (Arquitetura) Lida com a submissão do formulário de acompanhamento individual.
 * AGORA INCLUI: Convocação, Contato, Providências da Família.
 * AGORA CALCULA: O status automaticamente.
 */
async function handleFollowUpSubmit(e) {
    e.preventDefault();
    const studentId = dom.followUpForm.dataset.studentId;
    const recordId = dom.followUpForm.dataset.recordId;
    
    if (!studentId || !recordId) {
        return showToast("Erro: ID do aluno ou do registo não encontrado.");
    }

    // ATUALIZADO: (Arquitetura) Coleta todos os dados do formulário de acompanhamento
    
    // Assumindo que os IDs no index.html serão atualizados (ex: 'follow-up-meeting-date')
    const parecer = document.getElementById('follow-up-parecer').value.trim();
    const contactSucceededRadio = document.querySelector('input[name="follow-up-contact-succeeded"]:checked');
    const contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;
    
    // --- LÓGICA DE STATUS AUTOMÁTICO ---
    let newStatus = 'Pendente'; // Padrão: Contato feito, mas sem parecer
    if (parecer) {
        newStatus = 'Resolvido';
    } else if (!contactSucceeded) {
        newStatus = 'Aguardando Contato';
    }
    // --- Fim da Lógica ---

    const dataToUpdate = {
        // Campos de Acompanhamento
        schoolActionsIndividual: document.getElementById('follow-up-actions').value.trim(),
        providenciasFamilia: document.getElementById('follow-up-family-actions').value.trim(), // Assumindo ID 'follow-up-family-actions'
        parecerIndividual: parecer,
        
        // Campos Movidos (Convocação)
        meetingDate: document.getElementById('follow-up-meeting-date').value || null, // Assumindo ID 'follow-up-meeting-date'
        meetingTime: document.getElementById('follow-up-meeting-time').value || null, // Assumindo ID 'follow-up-meeting-time'
        
        // Campos Movidos (Contato)
        contactSucceeded: contactSucceeded,
        contactType: contactSucceeded === 'yes' ? document.getElementById('follow-up-contact-type').value : null, // Assumindo ID 'follow-up-contact-type'
        contactDate: contactSucceeded === 'yes' ? document.getElementById('follow-up-contact-date').value : null, // Assumindo ID 'follow-up-contact-date'

        // Status Automático
        statusIndividual: newStatus
    };
    
    const historyAction = `Acompanhamento atualizado (Status: ${dataToUpdate.statusIndividual}).`;

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Acompanhamento salvo com sucesso!");
        closeModal(dom.followUpModal);
    } catch (error) {
        console.error("Erro ao salvar acompanhamento:", error);
        // ATUALIZADO: (Melhoria) Mensagem de erro mais específica.
        showToast(getFirestoreErrorMessage(error.code) || 'Erro ao salvar o acompanhamento.');
    }
}


async function handleAbsenceSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
        form.reportValidity();
        return showToast('Por favor, preencha todos os campos obrigatórios.');
    }
    
    const data = getAbsenceFormData();
    if (!data) return;

    try {
        const id = data.id;
        delete data.id;
        
        const historyAction = id ? "Dados da ação atualizados." : `Ação de Busca Ativa registada.`;

        if (id) {
            await updateRecordWithHistory('absence', id, data, historyAction, state.userEmail);
        } else {
            await addRecordWithHistory('absence', data, historyAction, state.userEmail);
        }

        showToast(`Ação ${id ? 'atualizada' : 'registada'} com sucesso!`);
        closeModal(dom.absenceModal);
        
        const studentReturned = data.contactReturned === 'yes' || data.visitReturned === 'yes';
        if (studentReturned) {
            const student = state.students.find(s => s.matricula === data.studentId);
            setTimeout(() => openAbsenceModalForStudent(student, 'analise'), 350);
        }
    } catch (error) { 
        // ATUALIZADO: (Melhoria) Mensagem de erro mais específica.
        console.error("Erro ao salvar ação de BA:", error);
        showToast(getFirestoreErrorMessage(error.code) || 'Erro ao salvar ação.'); 
    }
}

async function handleSettingsSubmit(e) {
    e.preventDefault();
    const data = {
        schoolName: document.getElementById('school-name-input').value.trim(),
        city: document.getElementById('school-city-input').value.trim(),
        schoolLogoUrl: document.getElementById('school-logo-input').value.trim()
    };

    try {
        await saveSchoolConfig(data);
        state.config = data; // Atualiza o estado local
        dom.headerSchoolName.textContent = data.schoolName || 'Sistema de Acompanhamento'; // Atualiza a UI imediatamente
        showToast('Configurações salvas com sucesso!');
        closeModal(dom.settingsModal);
    } catch (error) {
        console.error("Erro ao salvar configurações:", error);
        showToast('Erro ao salvar as configurações.');
    }
}

// Funções de Gerenciamento de Alunos
function handleCsvUpload() {
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
                showToast("Erro ao salvar a nova lista de alunos.");
            }
        }
    });
}

async function handleStudentFormSubmit(e) {
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
        showToast("Erro ao salvar dados do aluno.");
    }
}

// Ações (Excluir, Gerar Relatório)
async function handleDeleteConfirmation() {
    if (!state.recordToDelete) return;
    const { type, id } = state.recordToDelete;
    try {
        if (type === 'occurrence') {
            const q = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', id));
            const querySnapshot = await getDocs(q);
            const batch = writeBatch(db);
            querySnapshot.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            showToast('Incidente e todos os registros associados foram excluídos.');
        } else if (type === 'absence-cascade') {
            const { ctId, analiseId } = state.recordToDelete;
            const batch = writeBatch(db);
            batch.delete(doc(getCollectionRef('absence'), ctId));
            if (analiseId) batch.delete(doc(getCollectionRef('absence'), analiseId));
            await batch.commit();
            showToast('Encaminhamento e Análise excluídos.');
        } else {
            // ATUALIZADO: (Melhoria) Usa `deleteRecord` para exclusão real.
            await deleteRecord(type, id);
            showToast('Registro excluído com sucesso.');
        }
    } catch (error) { showToast('Erro ao excluir.'); console.error(error); } finally { state.recordToDelete = null; closeModal(dom.deleteConfirmModal); }
}

function handleReportGeneration() {
    const studentId = document.getElementById('student-select').value;
    if (!studentId) return showToast('Por favor, selecione um aluno.');
    const reportType = dom.reportGeneratorModal.dataset.reportType;
    if (reportType === 'occurrences') {
        showToast("Use o Relatório Geral e o filtro de aluno para gerar relatórios individuais.");
    } else {
        generateAndShowConsolidatedFicha(studentId);
    }
    closeModal(dom.reportGeneratorModal);
}

// Lógica de UI e Dados
function getOccurrenceHistoryMessage(original, updated) {
    const changes = [];
    // Esta função era do fluxo antigo, agora a lógica de histórico está
    // em `handleOccurrenceSubmit` e `handleFollowUpSubmit`.
    if (original.status !== updated.status) changes.push(`Status alterado de "${original.status}" para "${updated.status}".`);
    if (original.parecer !== updated.parecer) changes.push(`Parecer foi ${updated.parecer ? 'adicionado/atualizado' : 'removido'}.`);
    
    if (changes.length > 0) return changes.join(' ');
    
    return "Dados do incidente foram atualizados.";
}

function getAbsenceFormData() {
    const studentName = document.getElementById('absence-student-name').value.trim();
    const student = state.students.find(s => s.name === studentName);
    if (!student) {
        showToast("Aluno inválido.");
        return null;
    }

    const data = {
        id: document.getElementById('absence-id').value,
        studentId: student.matricula,
        actionType: document.getElementById('action-type').value,
        processId: document.getElementById('absence-process-id').value,
        periodoFaltasStart: document.getElementById('absence-start-date').value || null,
        periodoFaltasEnd: document.getElementById('absence-end-date').value || null,
        absenceCount: document.getElementById('absence-count').value || null,
    };

    if (data.actionType.startsWith('tentativa')) {
        const contactSucceeded = document.querySelector('input[name="contact-succeeded"]:checked');
        data.meetingDate = document.getElementById('meeting-date').value || null;
        data.meetingTime = document.getElementById('meeting-time').value || null;
        data.contactSucceeded = contactSucceeded ? contactSucceeded.value : null;
        if (data.contactSucceeded === 'yes') {
            data.contactType = document.getElementById('absence-contact-type').value || null;
            data.contactDate = document.getElementById('contact-date').value || null;
            data.contactPerson = document.getElementById('contact-person').value || null;
            data.contactReason = document.getElementById('contact-reason').value || null;
        }
        const contactReturned = document.querySelector('input[name="contact-returned"]:checked');
        data.contactReturned = contactReturned ? contactReturned.value : null;
    } else if (data.actionType === 'visita') {
        const visitSucceeded = document.querySelector('input[name="visit-succeeded"]:checked');
        data.visitAgent = document.getElementById('visit-agent').value || null;
        data.visitDate = document.getElementById('visit-date').value || null;
        data.visitSucceeded = visitSucceeded ? visitSucceeded.value : null;
        if (data.visitSucceeded === 'yes') {
            data.visitContactPerson = document.getElementById('visit-contact-person').value || null;
            data.visitReason = document.getElementById('visit-reason').value || null;
            data.visitObs = document.getElementById('visit-obs').value || null;
        }
        const visitReturned = document.querySelector('input[name="visit-returned"]:checked');
        data.visitReturned = visitReturned ? visitReturned.value : null;
    } else if (data.actionType === 'encaminhamento_ct') {
        data.ctSentDate = document.getElementById('ct-sent-date').value || null;
        data.ctFeedback = document.getElementById('ct-feedback').value || null;
        const ctReturned = document.querySelector('input[name="ct-returned"]:checked');
        data.ctReturned = ctReturned ? ctReturned.value : null;
    } else if (data.actionType === 'analise') {
        data.ctParecer = document.getElementById('ct-parecer').value || null;
    }
    return data;
}

function handleActionTypeChange(action) {
    document.querySelectorAll('.dynamic-field-group').forEach(group => group.classList.add('hidden'));
    const groupToShow = action.startsWith('tentativa') ? 'group-tentativas' : `group-${action}`;
    const groupElement = document.getElementById(groupToShow);
    if (groupElement) groupElement.classList.remove('hidden');
}

// --- CONFIGURAÇÃO DE LISTENERS DINÂMICOS ---

function setupModalCloseButtons() {
    // ATUALIZADO: (Bug Fix) Adicionado 'cancel-follow-up-btn'.
    // Isto assume que o botão "Cancelar" no index.html terá o id="cancel-follow-up-btn"
    // e o onclick="" removido.
    const modalMap = {
        'close-modal-btn': dom.occurrenceModal, 'cancel-btn': dom.occurrenceModal,
        'close-absence-modal-btn': dom.absenceModal, 'cancel-absence-btn': dom.absenceModal,
        'close-report-generator-btn': dom.reportGeneratorModal, 'cancel-report-generator-btn': dom.reportGeneratorModal,
        'close-notification-btn': dom.notificationModalBackdrop,
        'close-student-selection-modal-btn': document.getElementById('student-selection-modal'),
        'close-report-view-btn': dom.reportViewModalBackdrop,
        'close-ficha-view-btn': dom.fichaViewModalBackdrop,
        'close-history-view-btn': document.getElementById('history-view-modal-backdrop'),
        'close-students-modal-btn': dom.studentsModal,
        'cancel-delete-btn': dom.deleteConfirmModal,
        'close-settings-modal-btn': dom.settingsModal,
        'cancel-settings-btn': dom.settingsModal, // Adicionado para consistência
        // NOVO: (Arquitetura & Bug Fix) Adiciona os botões de fechar do novo modal.
        'close-follow-up-modal-btn': dom.followUpModal,
        'cancel-follow-up-btn': dom.followUpModal // << Correção do Bug
    };

    for (const [id, modal] of Object.entries(modalMap)) {
        const button = document.getElementById(id);
        if (button && modal) {
            // Remove o onclick inline para evitar bugs, se ele existir (como no botão Cancelar)
            if (button.hasAttribute('onclick')) {
                button.removeAttribute('onclick');
            }
            button.addEventListener('click', () => closeModal(modal));
        } else if (!button && id === 'cancel-follow-up-btn') {
             // Aviso para o desenvolvedor (você) caso o ID não seja encontrado
             console.warn("O botão 'cancel-follow-up-btn' não foi encontrado. Certifique-se de que o ID está no index.html.");
        }
    }

    document.getElementById('share-btn').addEventListener('click', () => shareContent(document.getElementById('notification-title').textContent, document.getElementById('notification-content').innerText));
    document.getElementById('report-share-btn').addEventListener('click', () => shareContent(document.getElementById('report-view-title').textContent, document.getElementById('report-view-content').innerText));
    document.getElementById('ficha-share-btn').addEventListener('click', () => shareContent(document.getElementById('ficha-view-title').textContent, document.getElementById('ficha-view-content').innerText));
    document.getElementById('print-btn').addEventListener('click', () => window.print());
    document.getElementById('report-print-btn').addEventListener('click', () => window.print());
    document.getElementById('ficha-print-btn').addEventListener('click', () => window.print());
}

/**
 * ATUALIZADO (Arquitetura): Lógica centralizada para todos os cliques nas listas.
 * Agora inclui a gestão do menu kebab e a nova ação 'follow-up'.
 */
function setupListClickListeners() {
    // Listener para a lista de OCORRÊNCIAS
    dom.occurrencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        // Ação do menu Kebab
        if (button.classList.contains('kebab-menu-btn')) {
            e.stopPropagation();
            const dropdown = button.nextElementSibling;
            if (dropdown) {
                // Fecha outros menus abertos para uma melhor experiência
                document.querySelectorAll('.kebab-menu-dropdown').forEach(d => {
                    if (d !== dropdown) d.classList.add('hidden');
                });
                dropdown.classList.toggle('hidden');
            }
            return; // Encerra a execução aqui para não acionar outras lógicas
        }

        const groupId = button.dataset.groupId;
        e.stopPropagation();

        if (button.classList.contains('notification-btn')) {
            openStudentSelectionModal(groupId);
        } else if (button.classList.contains('record-btn')) {
            openOccurrenceRecordModal(groupId);
        } else if (button.classList.contains('kebab-action-btn')) {
            const action = button.dataset.action;
            if (action === 'edit') handleEditOccurrence(groupId);
            else if (action === 'delete') handleDelete('occurrence', groupId);
            else if (action === 'history') openHistoryModal(groupId);
            // NOVO: (Arquitetura) Chama a função para abrir o modal de acompanhamento.
            else if (action === 'follow-up') openFollowUpModal(groupId);
            // Esconde o menu após a ação
            button.closest('.kebab-menu-dropdown').classList.add('hidden');
        }
    });

    // Listener para a lista de BUSCA ATIVA
    dom.absencesListDiv.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (button) {
            e.stopPropagation();

             if (button.classList.contains('kebab-menu-btn')) {
                const dropdown = button.nextElementSibling;
                if (dropdown) {
                    document.querySelectorAll('.kebab-menu-dropdown').forEach(d => {
                        if (d !== dropdown) d.classList.add('hidden');
                    });
                    dropdown.classList.toggle('hidden');
                }
                return;
            }

            const id = button.dataset.id;
            
            if (button.classList.contains('notification-btn')) openFichaViewModal(id);
            else if (button.classList.contains('send-ct-btn')) handleSendToCT(id);
            else if (button.classList.contains('view-oficio-btn')) handleViewOficio(id);
            else if (button.classList.contains('generate-ficha-btn-row')) generateAndShowConsolidatedFicha(button.dataset.studentId, button.dataset.processId);
            else if (button.classList.contains('kebab-action-btn')) {
                const action = button.dataset.action;
                if (action === 'edit') handleEditAbsence(id);
                else if (action === 'delete') handleDeleteAbsence(id);
                else if (action === 'history') openAbsenceHistoryModal(button.dataset.processId);
                button.closest('.kebab-menu-dropdown').classList.add('hidden');
            }
            return;
        }

        const newActionTrigger = e.target.closest('.new-action-from-history-btn');
        if (newActionTrigger) {
            e.stopPropagation();
            handleNewAbsenceFromHistory(newActionTrigger.dataset.studentId);
            return;
        }
        
        const header = e.target.closest('.process-header');
        if (header) {
            const id = header.dataset.processId;
            const content = document.getElementById(`content-${id}`);
            const icon = header.querySelector('i.fa-chevron-down');
            if (content) {
                const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
                content.style.maxHeight = isHidden ? `${content.scrollHeight}px` : null;
                icon?.classList.toggle('rotate-180', isHidden);
            }
        }
    });
}

// Funções de Manipulação de Eventos das Listas
function handleEditOccurrence(groupId) {
    const incident = getFilteredOccurrences().get(groupId);
    if (incident) {
        openOccurrenceModal(incident);
    } else {
        showToast('Incidente não encontrado para edição.');
    }
}

function handleDelete(type, id) {
    document.getElementById('delete-confirm-message').textContent = 'Tem certeza que deseja excluir este incidente e todos os seus registros? Esta ação não pode ser desfeita.';
    state.recordToDelete = { type, id };
    openModal(dom.deleteConfirmModal);
}

function handleEditAbsence(id) {
    const data = state.absences.find(a => a.id === id);
    const student = data ? state.students.find(s => s.matricula === data.studentId) : null;
    if (student) openAbsenceModalForStudent(student, data.actionType, data);
}

function handleDeleteAbsence(id) {
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
}

async function handleSendToCT(id) {
    const oficioNumber = prompt("Por favor, insira o número do ofício:");
    if (oficioNumber?.trim()) {
        const visitAction = state.absences.find(a => a.id === id);
        if (visitAction) {
            generateAndShowOficio(visitAction, oficioNumber);
            const student = state.students.find(s => s.matricula === visitAction.studentId);
            if (!student) return;

            const { processId, currentCycleActions } = logic.getStudentProcessInfo(student.matricula);
            if (currentCycleActions.some(a => a.actionType === 'encaminhamento_ct')) return;

            const firstAction = currentCycleActions.find(a => a.periodoFaltasStart);
            const dataForCt = {
                studentId: student.matricula, actionType: 'encaminhamento_ct', processId,
                ctSentDate: new Date().toISOString().split('T')[0],
                oficioNumber, oficioYear: new Date().getFullYear(),
                periodoFaltasStart: firstAction?.periodoFaltasStart || null,
                periodoFaltasEnd: firstAction?.periodoFaltasEnd || null,
                absenceCount: firstAction?.absenceCount || null,
            };
            try {
                await addRecordWithHistory('absence', dataForCt, "Ação 'Encaminhamento ao CT' registada.", state.userEmail);
                showToast("Registro de 'Encaminhamento ao CT' salvo automaticamente.");
            } catch(err) {
                showToast("Erro ao salvar o encaminhamento automático.");
            }
        }
    }
}

function handleViewOficio(id) {
    const ctAction = state.absences.find(a => a.id === id);
    if (ctAction) generateAndShowOficio(ctAction);
}

function handleNewAbsenceFromHistory(studentId) {
    const student = state.students.find(s => s.matricula === studentId);
    if (student) handleNewAbsenceAction(student);
}

/**
 * NOVO: (Otimização) Lida com todas as ações na tabela de alunos usando delegação de eventos.
 * @param {Event} e - O objeto do evento de clique.
 */
async function handleStudentTableActions(e) {
    const editBtn = e.target.closest('.edit-student-btn');
    if (editBtn) {
        const id = editBtn.dataset.id;
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
        return;
    }

    const deleteBtn = e.target.closest('.delete-student-btn');
    if (deleteBtn) {
        const id = deleteBtn.dataset.id;
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
                // ATUALIZADO: (Melhoria) Mensagem de erro mais específica.
                showToast(getFirestoreErrorMessage(error.code) || "Erro ao remover aluno.");
            }
        }
    }
}
