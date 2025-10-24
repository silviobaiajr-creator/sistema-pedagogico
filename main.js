// =================================================================================
// ARQUIVO: main.js
// RESPONSABILIDADE: Ponto de entrada. Orquestra inicialização, autenticação,
//                   carregamento de dados e delegação de eventos globais.
// ATUALIZAÇÃO: Removida a chamada a initAdmin(). Delegação para botões admin adicionada.
// =================================================================================

// --- MÓDULOS IMPORTADOS ---
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { onSnapshot, query, writeBatch, doc, setDoc, where, getDocs, collection, runTransaction, arrayUnion } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; // Adicionado arrayUnion
import { auth, db } from './firebase.js';
import { state, dom, initializeDOMReferences } from './state.js';
import { showToast, closeModal, shareContent, openModal } from './utils.js';
import { loadStudents, loadSchoolConfig, getCollectionRef, getStudentsDocRef, getCounterDocRef, updateRecordWithHistory, addRecordWithHistory, deleteRecord } from './firestore.js'; // Removido saveSchoolConfig (não usado aqui)
import {
    render,
    openOccurrenceModal, // Ainda aqui, será movido para module-occurrences
    handleNewAbsenceAction, // Ainda aqui, será movido para module-absences
    setupAutocomplete,
    openAbsenceModalForStudent, // Ainda aqui, será movido para module-absences
    getFilteredOccurrences, // Necessário para handleEditOccurrence
    openFollowUpModal, // Ainda aqui, será movido para module-occurrences
    setupStudentTagInput, // Será movido
    toggleFamilyContactFields, // Será movido
    toggleVisitContactFields // Será movido
} from './ui.js';
import {
    openStudentSelectionModal, // Será movido
    openOccurrenceRecordModal, // Será movido
    openHistoryModal, // Será movido
    openAbsenceHistoryModal, // Será movido
    openFichaViewModal, // Será movido
    generateAndShowConsolidatedFicha, // Será movido
    generateAndShowOficio, // Será movido
    generateAndShowGeneralReport, // Será movido
    generateAndShowBuscaAtivaReport // Será movido
} from './reports.js';
import * as logic from './logic.js';
import { initAuth } from './module-auth.js';
// Importa APENAS as funções de ABERTURA de modal do module-admin
import { openSettingsModal, openStudentsModalAdmin } from './module-admin.js';


// --- INICIALIZAÇÃO DA APLICAÇÃO ---

document.addEventListener('DOMContentLoaded', () => {
    initializeDOMReferences(); // Garante que as refs DOM são preenchidas primeiro
    state.db = db; // Armazena instância do DB no estado

    // Inicia a autenticação, passando os callbacks
    initAuth(initializeAppState, clearAppState);

    // Configura listeners globais que NÃO dependem de login (ex: fechar modais, delegação header)
    setupGlobalEventListeners();
});

// --- CONTROLE DE ESTADO DA APLICAÇÃO ---

/**
 * Chamado pelo module-auth quando o utilizador faz login.
 * Carrega dados iniciais e configura listeners específicos da aplicação.
 */
async function initializeAppState(user) {
    console.log("Utilizador autenticado:", user.email);
    state.userId = user.uid;
    state.userEmail = user.email;
    if(dom.userEmail) dom.userEmail.textContent = user.email || `Utilizador: ${user.uid.substring(0, 8)}`;

    // Mostra a UI principal e esconde a de login
    if(dom.loginScreen) dom.loginScreen.classList.add('hidden');
    if(dom.mainContent) dom.mainContent.classList.remove('hidden');
    if(dom.userProfile) dom.userProfile.classList.remove('hidden');

    try {
        // Mostra um estado de carregamento inicial
        if(dom.loadingOccurrences) dom.loadingOccurrences.classList.remove('hidden');
        if(dom.loadingAbsences) dom.loadingAbsences.classList.remove('hidden');
        if(dom.occurrencesListDiv) dom.occurrencesListDiv.innerHTML = ''; // Limpa listas
        if(dom.absencesListDiv) dom.absencesListDiv.innerHTML = '';

        // Carrega dados essenciais
        await loadSchoolConfig();
        await loadStudents();
        if(dom.headerSchoolName) dom.headerSchoolName.textContent = state.config.schoolName || 'Sistema de Acompanhamento';

        setupFirestoreListeners(); // Inicia a escuta por dados em tempo real

        // Configura listeners específicos da aplicação (que dependem de dados carregados)
        setupAppEventListeners(); // Abas, filtros, botões das abas, etc.

        // Define a aba inicial e renderiza
        switchTab('occurrences'); // Garante que a aba inicial seja Ocorrências
        // render(); // render() é chamado dentro de switchTab e pelos listeners do Firestore

    } catch (error) {
        console.error("Erro CRÍTICO ao inicializar estado da aplicação:", error);
        showToast("Erro grave ao carregar dados iniciais: " + error.message + ". Tente recarregar.");
        // Considerar deslogar o utilizador ou mostrar uma mensagem mais permanente
        // signOut(auth);
    } finally {
         // Esconde loading após tentativa (após um pequeno delay para UI)
         setTimeout(() => {
            if(dom.loadingOccurrences) dom.loadingOccurrences.classList.add('hidden');
            if(dom.loadingAbsences) dom.loadingAbsences.classList.add('hidden');
            // Mostra estado vazio se as listas ainda estiverem vazias após o load inicial
            if(dom.occurrencesListDiv && dom.occurrencesListDiv.innerHTML === '' && state.occurrences.length === 0) {
                 if(dom.emptyStateOccurrences) dom.emptyStateOccurrences.classList.remove('hidden');
            }
             if(dom.absencesListDiv && dom.absencesListDiv.innerHTML === '' && state.absences.length === 0) {
                 if(dom.emptyStateAbsences) dom.emptyStateAbsences.classList.remove('hidden');
            }
         }, 500); // Aumentar delay se necessário
    }
}

/**
 * Chamado pelo module-auth quando o utilizador faz logout.
 * Limpa o estado da aplicação e os listeners.
 */
function clearAppState() {
    console.log("Utilizador deslogado.");
    detachFirestoreListeners(); // Para listeners do Firestore
    // REMOVER outros listeners específicos da app se necessário (embora muitos estejam via delegação)

    // Limpa estado
    state.userId = null;
    state.userEmail = null;
    state.students = [];
    state.occurrences = [];
    state.absences = [];
    state.filterOccurrences = '';
    state.filterAbsences = '';
    state.selectedStudents.clear();
    state.recordToDelete = null;
    // Resetar filtros para 'all' ou valores padrão
    state.filtersOccurrences = { startDate: null, endDate: null, type: 'all', status: 'all' };
    state.filtersAbsences = { processStatus: 'all', pendingAction: 'all', returnStatus: 'all' };


    // Atualiza UI
    if(dom.mainContent) dom.mainContent.classList.add('hidden');
    if(dom.userProfile) dom.userProfile.classList.add('hidden');
    if(dom.loginScreen) dom.loginScreen.classList.remove('hidden');
    // Limpa conteúdo das listas e filtros na UI
    if(dom.occurrencesListDiv) dom.occurrencesListDiv.innerHTML = '';
    if(dom.absencesListDiv) dom.absencesListDiv.innerHTML = '';
    if(dom.searchOccurrences) dom.searchOccurrences.value = '';
    if(dom.searchAbsences) dom.searchAbsences.value = '';
    // Resetar selects de filtro (opcional, mas bom para UX)
    const occTypeFilter = document.getElementById('occurrence-filter-type');
    const occStatusFilter = document.getElementById('occurrence-filter-status');
    if (occTypeFilter) occTypeFilter.value = 'all';
    if (occStatusFilter) occStatusFilter.value = 'all';
    // Adicionar reset para filtros de Busca Ativa se necessário
}


// --- SINCRONIZAÇÃO COM O BANCO DE DADOS ---

function setupFirestoreListeners() {
     if (!state.userId) {
          console.warn("Tentativa de configurar listeners sem userId.");
          return;
     }

    // Desliga listeners antigos se existirem (segurança extra)
    detachFirestoreListeners();
    console.log("A configurar listeners do Firestore...");

    try {
        const occurrencesQuery = query(getCollectionRef('occurrence'));
        state.unsubscribeOccurrences = onSnapshot(occurrencesQuery, (snapshot) => {
            console.log(`Recebidas ${snapshot.docs.length} ocorrências.`);
            state.occurrences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
             if(dom.emptyStateOccurrences) dom.emptyStateOccurrences.classList.toggle('hidden', state.occurrences.length > 0);
            if (state.activeTab === 'occurrences') render(); // Re-renderiza APENAS se a aba estiver ativa
        }, (error) => {
            console.error("Erro Crítico no listener de ocorrências:", error);
            showToast("Erro ao carregar ocorrências em tempo real. A lista pode estar desatualizada.");
            // Considerar desativar listeners ou tentar reconectar
        });

        const absencesQuery = query(getCollectionRef('absence'));
        state.unsubscribeAbsences = onSnapshot(absencesQuery, (snapshot) => {
             console.log(`Recebidas ${snapshot.docs.length} ações de BA.`);
            state.absences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
             if(dom.emptyStateAbsences) dom.emptyStateAbsences.classList.toggle('hidden', state.absences.length > 0);
            if (state.activeTab === 'absences') render(); // Re-renderiza APENAS se a aba estiver ativa
        }, (error) => {
            console.error("Erro Crítico no listener de busca ativa:", error);
            showToast("Erro ao carregar busca ativa em tempo real. A lista pode estar desatualizada.");
        });
    } catch (error) {
         console.error("Erro GERAL ao configurar listeners do Firestore:", error);
         showToast("Não foi possível conectar à base de dados em tempo real.");
    }
}

function detachFirestoreListeners() {
    let detached = false;
    if (state.unsubscribeOccurrences) {
        state.unsubscribeOccurrences();
        state.unsubscribeOccurrences = null;
        detached = true;
    }
    if (state.unsubscribeAbsences) {
        state.unsubscribeAbsences();
        state.unsubscribeAbsences = null;
        detached = true;
    }
    if(detached) console.log("Listeners do Firestore desligados.");
}

// --- CONFIGURAÇÃO DE EVENT LISTENERS ---

/**
 * Configura listeners globais que não dependem do estado de login
 * ou de dados carregados (ex: fechar modais, delegação header).
 */
function setupGlobalEventListeners() {
    console.log("A configurar listeners globais...");
    // Fechar Modais (usando delegação no body)
    document.body.addEventListener('click', (e) => {
        // Fecha modal se clicar no backdrop
        if (e.target.classList.contains('modal-backdrop')) {
            closeModal(e.target);
        }
        // Fecha modal se clicar num botão "X" ou "Cancelar" (procura pelo ID)
        const closeButton = e.target.closest('button');
        if (closeButton) {
            const modalToClose = getModalFromCloseButtonId(closeButton.id);
            if (modalToClose) {
                closeModal(modalToClose);
            }
        }

        // Fecha menus Kebab abertos se clicar fora deles
         if (!e.target.closest('.kebab-menu-container')) {
            document.querySelectorAll('.kebab-menu-dropdown:not(.hidden)').forEach(dropdown => {
                dropdown.classList.add('hidden');
                 // Restaura overflow do acordeão BA se aplicável
                 const contentParent = dropdown.closest('.process-content');
                 if(contentParent && contentParent.style.overflow === 'visible') {
                      contentParent.style.overflow = 'hidden';
                 }
            });
        }
    });

    // Botão de Logout
    if (dom.logoutBtn) {
        dom.logoutBtn.addEventListener('click', () => {
             signOut(auth).catch(error => {
                 console.error("Erro ao fazer logout:", error);
                 showToast("Erro ao sair da conta.");
             });
        });
    } else {
         console.error("Erro Crítico: Botão #logout-btn não encontrado no DOM.");
    }

    // --- Delegação de Eventos para botões do Cabeçalho ---
    const headerElement = document.querySelector('header'); // Delega no header
    if (headerElement) {
        headerElement.addEventListener('click', (event) => {
            const targetButton = event.target.closest('button');
            if (!targetButton) return;

            if (targetButton.id === 'settings-btn') {
                openSettingsModal(); // Chama a função importada
            }
            else if (targetButton.id === 'manage-students-btn') {
                 openStudentsModalAdmin(); // Chama a função importada
            }
            // Não precisa de listener para logout aqui, já foi adicionado acima
        });
    } else {
        console.error("Erro Crítico: Elemento <header> não encontrado para delegação de eventos.");
    }

     // Listeners para os botões de Partilhar/Imprimir nos modais de visualização
     setupSharePrintListeners('notification-modal-backdrop', 'notification-title', 'notification-content');
     setupSharePrintListeners('report-view-modal-backdrop', 'report-view-title', 'report-view-content');
     setupSharePrintListeners('ficha-view-modal-backdrop', 'ficha-view-title', 'ficha-view-content');

     // Botão de confirmação de exclusão
     const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
     if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener('click', handleDeleteConfirmation);
     } else {
         console.error("Erro Crítico: Botão #confirm-delete-btn não encontrado.");
     }
}

/** Helper para configurar Share/Print */
function setupSharePrintListeners(modalId, titleId, contentId) {
    const modalElement = document.getElementById(modalId);
    if (!modalElement) {
         console.warn(`Modal #${modalId} não encontrado para listeners Share/Print.`);
         return;
    }

    const shareBtn = modalElement.querySelector('button[id$="-share-btn"]');
    const printBtn = modalElement.querySelector('button[id$="-print-btn"]');

    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            const titleElement = document.getElementById(titleId);
            const contentElement = document.getElementById(contentId);
            if (titleElement && contentElement) {
                shareContent(titleElement.textContent, contentElement.innerText);
            } else {
                console.error(`Elementos de título (${titleId}) ou conteúdo (${contentId}) não encontrados para partilhar.`);
            }
        });
    }
    if (printBtn) {
        printBtn.addEventListener('click', () => {
             // Esconde botões antes de imprimir, mostra depois
             const buttonsContainer = printBtn.parentElement;
             if (buttonsContainer) buttonsContainer.classList.add('hidden');
             window.print();
             if (buttonsContainer) buttonsContainer.classList.remove('hidden');
        });
    }
}


/** Helper para encontrar modal a partir do botão fechar */
function getModalFromCloseButtonId(buttonId) {
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
        'close-settings-modal-btn': dom.settingsModal, 'cancel-settings-btn': dom.settingsModal,
        'close-follow-up-modal-btn': dom.followUpModal, 'cancel-follow-up-btn': dom.followUpModal
    };
    // Verifica se os elementos DOM referenciados existem antes de retornar
    return dom[Object.keys(modalMap).find(key => modalMap[key] === modalMap[buttonId])] ? modalMap[buttonId] : null;
}

/**
 * Configura listeners específicos da aplicação que dependem do login
 * e/ou dos dados carregados (alunos, ocorrências, etc.).
 * Estes listeners serão movidos para seus respectivos módulos futuramente.
 */
function setupAppEventListeners() {
    console.log("A configurar listeners específicos da aplicação...");

    // Navegação por Abas
    if (dom.tabOccurrences) dom.tabOccurrences.addEventListener('click', () => switchTab('occurrences'));
    else console.error("#tab-occurrences não encontrado.");
    if (dom.tabAbsences) dom.tabAbsences.addEventListener('click', () => switchTab('absences'));
    else console.error("#tab-absences não encontrado.");

    // --- Ocorrências: Listeners (serão movidos) ---
    const addOccurrenceBtn = document.getElementById('add-occurrence-btn');
    if (addOccurrenceBtn) addOccurrenceBtn.addEventListener('click', () => openOccurrenceModal());
    else console.error("#add-occurrence-btn não encontrado.");

    if (dom.occurrenceForm) dom.occurrenceForm.addEventListener('submit', handleOccurrenceSubmit);
    else console.error("#occurrence-form não encontrado.");

    if (dom.followUpForm) dom.followUpForm.addEventListener('submit', handleFollowUpSubmit);
    else console.error("#follow-up-form não encontrado.");

    if (dom.searchOccurrences) dom.searchOccurrences.addEventListener('input', (e) => { state.filterOccurrences = e.target.value; render(); });
    else console.error("#search-occurrences não encontrado.");

    if (dom.occurrenceStartDate) dom.occurrenceStartDate.addEventListener('change', (e) => { state.filtersOccurrences.startDate = e.target.value || null; render(); });
    else console.error("#occurrence-start-date não encontrado.");

    if (dom.occurrenceEndDate) dom.occurrenceEndDate.addEventListener('change', (e) => { state.filtersOccurrences.endDate = e.target.value || null; render(); });
    else console.error("#occurrence-end-date não encontrado.");

    const filterType = document.getElementById('occurrence-filter-type');
    if (filterType) filterType.addEventListener('change', (e) => { state.filtersOccurrences.type = e.target.value; render(); });
    else console.error("#occurrence-filter-type não encontrado.");

    const filterStatus = document.getElementById('occurrence-filter-status');
    if (filterStatus) filterStatus.addEventListener('change', (e) => { state.filtersOccurrences.status = e.target.value; render(); });
    else console.error("#occurrence-filter-status não encontrado.");

    if (dom.generalReportBtn) dom.generalReportBtn.addEventListener('click', generateAndShowGeneralReport);
    else console.error("#general-report-btn não encontrado.");

    // --- Busca Ativa: Listeners (serão movidos) ---
    if (dom.absenceForm) dom.absenceForm.addEventListener('submit', handleAbsenceSubmit);
    else console.error("#absence-form não encontrado.");

    if (dom.generalBaReportBtn) dom.generalBaReportBtn.addEventListener('click', generateAndShowBuscaAtivaReport);
    else console.error("#general-ba-report-btn não encontrado.");

    const filterProcStatus = document.getElementById('filter-process-status');
    if (filterProcStatus) filterProcStatus.addEventListener('change', (e) => { state.filtersAbsences.processStatus = e.target.value; render(); });
    else console.error("#filter-process-status não encontrado.");

    const filterPendAction = document.getElementById('filter-pending-action');
    if (filterPendAction) filterPendAction.addEventListener('change', (e) => { state.filtersAbsences.pendingAction = e.target.value; render(); });
    else console.error("#filter-pending-action não encontrado.");

    const filterRetStatus = document.getElementById('filter-return-status');
    if (filterRetStatus) filterRetStatus.addEventListener('change', (e) => { state.filtersAbsences.returnStatus = e.target.value; render(); });
    else console.error("#filter-return-status não encontrado.");

    // Autocomplete Busca Ativa (depende da lista de alunos)
    // Garante que a lista de alunos está carregada antes de configurar
    if (state.students.length > 0) {
        setupAutocomplete('search-absences', 'absence-student-suggestions', handleNewAbsenceAction);
    } else {
        console.warn("Lista de alunos vazia, autocomplete da Busca Ativa não configurado inicialmente.");
        // Considerar re-tentar configurar após loadStudents ou no primeiro render
    }


    // Ações nas Listas (Ocorrências e Busca Ativa) - Delegação
    setupListClickListeners();

     // Listeners para os rádios (mostra/esconde campos)
     setupAbsenceRadioListeners(); // (será movido)
     setupFollowUpRadioListener(); // (será movido)
}

/** Configura radios BA (será movido) */
function setupAbsenceRadioListeners() {
     const modal = dom.absenceModal;
     if (!modal) return;
     const contactRadios = modal.querySelectorAll('input[name="contact-succeeded"]');
     const visitRadios = modal.querySelectorAll('input[name="visit-succeeded"]');
     const familyContactFields = modal.querySelector('#family-contact-fields');
     const visitContactFields = modal.querySelector('#visit-contact-fields');

     if (contactRadios.length > 0 && familyContactFields) {
        contactRadios.forEach(radio => radio.addEventListener('change', (e) => toggleFamilyContactFields(e.target.value === 'yes', familyContactFields)));
     }
     if (visitRadios.length > 0 && visitContactFields) {
        visitRadios.forEach(radio => radio.addEventListener('change', (e) => toggleVisitContactFields(e.target.value === 'yes', visitContactFields)));
     }
}

/** Configura radio Acompanhamento (será movido) */
function setupFollowUpRadioListener() {
    const modal = dom.followUpModal;
    if (!modal) return;
    const followUpRadios = modal.querySelectorAll('input[name="follow-up-contact-succeeded"]');
    const followUpContactFields = modal.querySelector('#follow-up-family-contact-fields');
    const familyActionsTextarea = modal.querySelector('#follow-up-family-actions');

    if (followUpRadios.length > 0 && followUpContactFields && familyActionsTextarea) {
        followUpRadios.forEach(radio =>
            radio.addEventListener('change', (e) => {
                const enable = e.target.value === 'yes';
                toggleFamilyContactFields(enable, followUpContactFields);

                familyActionsTextarea.required = enable;
                const label = familyActionsTextarea.closest('div')?.querySelector('label'); // Usa optional chaining
                if (label) {
                    label.innerHTML = enable
                        ? 'Providências da Família <span class="text-red-500">*</span>'
                        : 'Providências da Família';
                }
            })
        );
         // Garante estado inicial correto (nenhum selecionado => esconde)
         const checkedRadio = modal.querySelector('input[name="follow-up-contact-succeeded"]:checked');
         if (!checkedRadio) {
              toggleFamilyContactFields(false, followUpContactFields);
              familyActionsTextarea.required = false;
              const label = familyActionsTextarea.closest('div')?.querySelector('label');
              if (label) label.innerHTML = 'Providências da Família';
         }
    }
}


// --- HANDLERS E FUNÇÕES AUXILIARES (serão movidos) ---

/** Troca de Abas */
function switchTab(tabName) {
    if (state.activeTab === tabName) return; // Não faz nada se já está na aba
    console.log(`A trocar para a aba: ${tabName}`);

    state.activeTab = tabName;
    const isOccurrences = tabName === 'occurrences';

    // Garante que os elementos existem antes de manipular classes
    if (dom.tabOccurrences) dom.tabOccurrences.classList.toggle('tab-active', isOccurrences);
    if (dom.tabAbsences) dom.tabAbsences.classList.toggle('tab-active', !isOccurrences);
    if (dom.tabContentOccurrences) dom.tabContentOccurrences.classList.toggle('hidden', !isOccurrences);
    if (dom.tabContentAbsences) dom.tabContentAbsences.classList.toggle('hidden', isOccurrences);

    // Limpa o filtro de busca ao trocar de aba
    state.filterOccurrences = '';
    state.filterAbsences = '';
    if(dom.searchOccurrences) dom.searchOccurrences.value = '';
    if(dom.searchAbsences) dom.searchAbsences.value = '';

    render(); // Re-renderiza o conteúdo da nova aba ativa
}

/** Submissão Ocorrência (será movido) */
async function handleOccurrenceSubmit(e) {
    e.preventDefault();
    const groupId = document.getElementById('occurrence-group-id').value;
    const form = e.target; // Referência ao formulário

    if (state.selectedStudents.size === 0) {
        return showToast("Selecione pelo menos um aluno.");
    }

    const occDate = document.getElementById('occurrence-date').value;
    const occType = document.getElementById('occurrence-type').value;
    const occDesc = document.getElementById('description').value.trim();
    if (!occDate || !occType || !occDesc) return showToast("Preencha Data, Tipo e Descrição.");

    const collectiveData = { date: occDate, occurrenceType: occType, description: occDesc };

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>A Salvar...';

    try {
        if (groupId) { // Edição
            const originalIncident = getFilteredOccurrences().get(groupId);
            if (!originalIncident) throw new Error("Incidente original não encontrado para edição.");

            const historyAction = "Dados gerais do fato foram atualizados.";
            const batch = writeBatch(db);
            const studentIdsInvolved = [...state.selectedStudents.keys()];
            const now = new Date();

            // 1. Atualiza dados coletivos + updatedAt/By para quem permanece
            originalIncident.records.forEach(record => {
                if (studentIdsInvolved.includes(record.studentId)) {
                    const recordRef = doc(getCollectionRef('occurrence'), record.id);
                    batch.update(recordRef, {
                        ...collectiveData,
                        updatedAt: now,
                        updatedBy: state.userEmail,
                        history: arrayUnion({ action: historyAction, user: state.userEmail, timestamp: now }) // Adiciona histórico aqui
                    });
                }
            });

            // 2. Adiciona novos alunos
            const templateRecord = originalIncident.records.find(r => studentIdsInvolved.includes(r.studentId)) || originalIncident.records[0] || {};
            const templateHistory = templateRecord.history || []; // Pega histórico existente como base

            for (const studentId of studentIdsInvolved) {
                const isNewStudent = !originalIncident.records.some(r => r.studentId === studentId);
                if (isNewStudent) {
                    const newRecordRef = doc(collection(db, getCollectionRef('occurrence').path)); // Cria novo ID
                    const newRecordData = {
                        ...collectiveData, studentId, occurrenceGroupId: groupId,
                        statusIndividual: 'Aguardando Contato', schoolActionsIndividual: '',
                        providenciasFamilia: '', parecerIndividual: '', meetingDate: null,
                        meetingTime: null, contactSucceeded: null, contactType: null, contactDate: null,
                        // Copia o histórico do template E adiciona a entrada de criação + edição
                        history: [
                            ...templateHistory,
                            { action: `Adicionado ao incidente ${groupId}.`, user: state.userEmail, timestamp: now }
                        ],
                        createdAt: now, createdBy: state.userEmail, updatedAt: now, updatedBy: state.userEmail,
                    };
                    batch.set(newRecordRef, newRecordData);
                }
            }

            // 3. Deleta registros de alunos removidos
            const removedRecordIds = originalIncident.records
                .filter(r => !studentIdsInvolved.includes(r.studentId))
                .map(r => r.id);
            removedRecordIds.forEach(recordId => batch.delete(doc(getCollectionRef('occurrence'), recordId)));

            await batch.commit();
            showToast('Fato da ocorrência atualizado com sucesso!');

        } else { // Criação
            const counterRef = getCounterDocRef('occurrences');
            const newGroupId = await runTransaction(db, async (transaction) => {
                const counterDoc = await transaction.get(counterRef);
                const currentYear = new Date().getFullYear();
                let newCount = 1;
                if (counterDoc.exists() && counterDoc.data().year === currentYear) {
                    newCount = (counterDoc.data().count || 0) + 1;
                }
                transaction.set(counterRef, { count: newCount, year: currentYear });
                return `OCC-${currentYear}-${String(newCount).padStart(3, '0')}`;
            });

            const initialHistoryAction = `Incidente ${newGroupId} registado.`;
            // Usaremos Promise.all para adicionar todos em paralelo
            const addPromises = [];
            for (const studentId of state.selectedStudents.keys()) {
                const recordData = {
                    ...collectiveData, studentId, occurrenceGroupId: newGroupId,
                    statusIndividual: 'Aguardando Contato', schoolActionsIndividual: '',
                    providenciasFamilia: '', parecerIndividual: '', meetingDate: null,
                    meetingTime: null, contactSucceeded: null, contactType: null, contactDate: null,
                };
                addPromises.push(addRecordWithHistory('occurrence', recordData, initialHistoryAction, state.userEmail));
            }
            await Promise.all(addPromises);
            showToast(`Ocorrência ${newGroupId} registada com sucesso!`);
        }
        closeModal(dom.occurrenceModal); // Fecha o modal em caso de sucesso
    } catch (error) {
        console.error("Erro ao salvar ocorrência:", error);
        showToast('Erro ao salvar a ocorrência. Tente novamente.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText; // Restaura o botão
    }
 }
/** Submissão Acompanhamento (será movido) */
async function handleFollowUpSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const studentId = form.dataset.studentId;
    const recordId = form.dataset.recordId;
    if (!studentId || !recordId) return showToast("Erro: ID não encontrado.");

    const parecer = document.getElementById('follow-up-parecer').value.trim();
    const contactSucceededRadio = form.querySelector('input[name="follow-up-contact-succeeded"]:checked');
    const contactSucceeded = contactSucceededRadio ? contactSucceededRadio.value : null;

    let newStatus = 'Pendente';
    if (parecer) newStatus = 'Resolvido';
    else if (!contactSucceeded || contactSucceeded === 'no') newStatus = 'Aguardando Contato';

    const dataToUpdate = {
        schoolActionsIndividual: document.getElementById('follow-up-actions').value.trim(),
        providenciasFamilia: document.getElementById('follow-up-family-actions').value.trim(),
        parecerIndividual: parecer,
        meetingDate: document.getElementById('follow-up-meeting-date').value || null,
        meetingTime: document.getElementById('follow-up-meeting-time').value || null,
        contactSucceeded: contactSucceeded,
        contactType: contactSucceeded === 'yes' ? (document.getElementById('follow-up-contact-type').value || null) : null,
        contactDate: contactSucceeded === 'yes' ? (document.getElementById('follow-up-contact-date').value || null) : null,
        statusIndividual: newStatus
    };

    const historyAction = `Acompanhamento individual atualizado (Status: ${newStatus}).`;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>A Salvar...';

    try {
        await updateRecordWithHistory('occurrence', recordId, dataToUpdate, historyAction, state.userEmail);
        showToast("Acompanhamento salvo com sucesso!");
        closeModal(dom.followUpModal);
    } catch (error) {
        console.error("Erro ao salvar acompanhamento:", error);
        showToast('Erro ao salvar o acompanhamento.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}
/** Submissão Busca Ativa (será movido) */
async function handleAbsenceSubmit(e) {
     e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
        form.reportValidity();
        const firstInvalid = form.querySelector(':invalid');
        const label = firstInvalid?.closest('div')?.querySelector('label')?.textContent || firstInvalid?.name;
        return showToast(label ? `Preencha o campo: ${label}.` : 'Preencha os campos obrigatórios.');
    }

    const data = getAbsenceFormData();
    if (!data) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>A Salvar...';

    try {
        const id = data.id; delete data.id; // Tira o ID do objeto
        const actionDisplay = actionDisplayTitles[data.actionType] || data.actionType; // Nome amigável da ação
        const historyAction = id ? `Dados da ação '${actionDisplay}' atualizados.` : `Ação '${actionDisplay}' registada.`;

        if (id) await updateRecordWithHistory('absence', id, data, historyAction, state.userEmail);
        else await addRecordWithHistory('absence', data, historyAction, state.userEmail);

        showToast(`Ação ${id ? 'atualizada' : 'registada'} com sucesso!`);
        closeModal(dom.absenceModal);

        // Lógica pós-salvamento: Sugere abrir Análise se aluno retornou
        const studentReturned = data.contactReturned === 'yes' || data.visitReturned === 'yes' || data.ctReturned === 'yes';
        if (studentReturned && data.actionType !== 'analise') {
             if (logic.determineNextActionForStudent(data.studentId) === 'analise') {
                const student = state.students.find(s => s.matricula === data.studentId);
                if (student) {
                    setTimeout(() => {
                         // Usar confirmação customizada se disponível, senão confirm()
                         const openAnalysis = window.confirm ? window.confirm("Aluno retornou. Deseja abrir a Análise agora?") : true;
                         if(openAnalysis) openAbsenceModalForStudent(student, 'analise');
                    }, 350);
                }
             }
        }
    } catch (error) {
        console.error("Erro ao salvar ação de BA:", error);
        showToast('Erro ao salvar ação de Busca Ativa.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
 }

/** Helper Pega Dados Form BA (será movido) */
function getAbsenceFormData() {
    const studentNameInput = document.getElementById('absence-student-name');
    const studentName = studentNameInput.value.trim();
    const student = state.students.find(s => s.name === studentName); // Busca pelo nome exato
    if (!student) {
        showToast("Aluno inválido. Selecione um aluno da lista ou digite o nome completo corretamente.");
        studentNameInput.focus(); // Foca no campo do nome
        return null;
    }

    const actionType = document.getElementById('action-type').value;
    if (!actionType) { showToast("Tipo de ação inválido."); return null; }

    const data = {
        id: document.getElementById('absence-id').value || null,
        studentId: student.matricula,
        actionType: actionType,
        processId: document.getElementById('absence-process-id').value,
        periodoFaltasStart: document.getElementById('absence-start-date').value || null,
        periodoFaltasEnd: document.getElementById('absence-end-date').value || null,
        absenceCount: document.getElementById('absence-count').value ? parseInt(document.getElementById('absence-count').value, 10) : null,
    };

    const getRadioValue = (name) => {
        const radio = document.querySelector(`input[name="${name}"]:checked`);
        return radio ? radio.value : null;
    }

    switch (data.actionType) {
        case 'tentativa_1': case 'tentativa_2': case 'tentativa_3':
            data.meetingDate = document.getElementById('meeting-date').value || null;
            data.meetingTime = document.getElementById('meeting-time').value || null;
            data.contactSucceeded = getRadioValue('contact-succeeded');
            if (data.contactSucceeded === 'yes') {
                data.contactType = document.getElementById('absence-contact-type').value || null;
                data.contactDate = document.getElementById('contact-date').value || null;
                data.contactPerson = document.getElementById('contact-person').value.trim() || null;
                data.contactReason = document.getElementById('contact-reason').value.trim() || null;
            } else { data.contactType = null; data.contactDate = null; data.contactPerson = null; data.contactReason = null; }
            data.contactReturned = getRadioValue('contact-returned');
            break;
        case 'visita':
            data.visitAgent = document.getElementById('visit-agent').value.trim() || null;
            data.visitDate = document.getElementById('visit-date').value || null;
            data.visitSucceeded = getRadioValue('visit-succeeded');
            if (data.visitSucceeded === 'yes') {
                data.visitContactPerson = document.getElementById('visit-contact-person').value.trim() || null;
                data.visitReason = document.getElementById('visit-reason').value.trim() || null;
                data.visitObs = document.getElementById('visit-obs').value.trim() || null;
            } else { data.visitContactPerson = null; data.visitReason = null; data.visitObs = null; }
            data.visitReturned = getRadioValue('visit-returned');
            break;
        case 'encaminhamento_ct':
            data.ctSentDate = document.getElementById('ct-sent-date').value || null;
            data.ctFeedback = document.getElementById('ct-feedback').value.trim() || null;
            // Assumindo que os campos de ofício foram adicionados ao HTML
            data.oficioNumber = document.getElementById('ct-oficio-number')?.value.trim() || null;
            data.oficioYear = document.getElementById('ct-oficio-year')?.value.trim() || new Date().getFullYear();
            data.ctReturned = getRadioValue('ct-returned');
            break;
        case 'analise':
            data.ctParecer = document.getElementById('ct-parecer').value.trim() || null;
            break;
        default: console.warn("Tipo de ação desconhecido:", data.actionType);
    }
    return data;
 }

/** Confirma Exclusão (global) */
async function handleDeleteConfirmation() {
     if (!state.recordToDelete) return;
    const { type, id } = state.recordToDelete;
    const confirmBtn = document.getElementById('confirm-delete-btn');
    const cancelBtn = document.getElementById('cancel-delete-btn');
    if (!confirmBtn || !cancelBtn) return; // Segurança
    const originalText = confirmBtn.textContent;

    confirmBtn.disabled = true; cancelBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>A Excluir...';

    try {
        if (type === 'occurrence') {
             const q = query(getCollectionRef('occurrence'), where('occurrenceGroupId', '==', id));
             const querySnapshot = await getDocs(q);
             if (querySnapshot.empty) {
                  await deleteRecord('occurrence', id); // Tenta excluir individualmente
                  showToast('Registro de ocorrência excluído.');
             } else {
                 const batch = writeBatch(db);
                 querySnapshot.forEach(doc => batch.delete(doc.ref));
                 await batch.commit();
                 showToast('Incidente e registros associados excluídos.');
             }
        } else if (type === 'absence-cascade') {
            const { ctId, analiseId } = state.recordToDelete;
            const batch = writeBatch(db);
            batch.delete(doc(getCollectionRef('absence'), ctId));
            if (analiseId) batch.delete(doc(getCollectionRef('absence'), analiseId));
            await batch.commit();
            showToast('Encaminhamento e Análise excluídos.');
        } else if (type === 'absence') {
            await deleteRecord('absence', id);
            showToast('Registro de Busca Ativa excluído.');
        } else { throw new Error(`Tipo inválido: ${type}`); }
    } catch (error) {
        console.error("Erro ao excluir:", error);
        showToast('Erro ao excluir o registro.');
    } finally {
        state.recordToDelete = null;
        closeModal(dom.deleteConfirmModal);
        confirmBtn.disabled = false; cancelBtn.disabled = false;
        confirmBtn.textContent = originalText; // Usar textContent em vez de innerHTML
    }
 }

/** Delegação Lista Clicks (será movido/refatorado) */
function setupListClickListeners() {
     // OCORRÊNCIAS
     if (dom.occurrencesListDiv) {
        dom.occurrencesListDiv.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;
            const groupId = button.dataset.groupId || e.target.closest('.student-follow-up-trigger')?.dataset.groupId; // Pega groupId de qualquer botão
            if (!groupId) return; // Sai se não achou groupId

            // Prioridades (Aluno > Kebab > Ação Direta > Ação Kebab)
            if (e.target.closest('.student-follow-up-trigger')) {
                 e.stopPropagation();
                 const studentId = e.target.closest('.student-follow-up-trigger').dataset.studentId;
                 if(studentId) openFollowUpModal(groupId, studentId);
            } else if (button.classList.contains('kebab-menu-btn')) {
                e.stopPropagation();
                const dropdown = button.nextElementSibling;
                if (dropdown?.classList.contains('kebab-menu-dropdown')) {
                    document.querySelectorAll('#occurrences-list .kebab-menu-dropdown').forEach(d => d !== dropdown && d.classList.add('hidden'));
                    dropdown.classList.toggle('hidden');
                }
            } else if (button.classList.contains('notification-btn')) {
                 e.stopPropagation(); openStudentSelectionModal(groupId);
            } else if (button.classList.contains('record-btn')) {
                 e.stopPropagation(); openOccurrenceRecordModal(groupId);
            } else if (button.classList.contains('kebab-action-btn')) {
                 e.stopPropagation();
                 const action = button.dataset.action;
                 if (action === 'edit') handleEditOccurrence(groupId);
                 else if (action === 'delete') handleDelete('occurrence', groupId);
                 else if (action === 'history') openHistoryModal(groupId);
                 else if (action === 'follow-up') openFollowUpModal(groupId);
                 button.closest('.kebab-menu-dropdown')?.classList.add('hidden'); // Fecha menu
            }
        });
     } else console.error("#occurrences-list não encontrado.");

    // BUSCA ATIVA
     if (dom.absencesListDiv) {
        dom.absencesListDiv.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            const header = e.target.closest('.process-header');
            const newActionTrigger = e.target.closest('.new-action-from-history-btn');

            if (newActionTrigger) { e.stopPropagation(); handleNewAbsenceFromHistory(newActionTrigger.dataset.studentId); return; }
            if (header && !button) { toggleAbsenceAccordion(header.dataset.processId, header); return; }
            if (!button) return; // Ignora cliques que não são em botões, headers ou no link do aluno
            e.stopPropagation(); // Impede clique no botão de afetar o acordeão

            // Lógica dos Botões (Kebab > Ações diretas > Ações kebab)
            if (button.classList.contains('kebab-menu-btn')) {
                 toggleAbsenceKebabMenu(button);
            } else {
                 const id = button.dataset.id; // ID da AÇÃO
                 const processId = button.dataset.processId || button.closest('[data-process-id]')?.dataset.processId; // ID do PROCESSO
                 const studentId = button.dataset.studentId;

                 if (button.classList.contains('notification-btn') && id) openFichaViewModal(id);
                 else if (button.classList.contains('send-ct-btn') && id) handleSendToCT(id);
                 else if (button.classList.contains('view-oficio-btn') && id) handleViewOficio(id);
                 else if (button.classList.contains('generate-ficha-btn-row') && studentId && processId) generateAndShowConsolidatedFicha(studentId, processId);
                 else if (button.classList.contains('kebab-action-btn')) {
                     const action = button.dataset.action;
                     if (action === 'edit' && id) handleEditAbsence(id);
                     else if (action === 'delete' && id) handleDelete('absence', id); // Chama handleDelete que chama setup
                     else if (action === 'history' && processId) openAbsenceHistoryModal(processId);

                     const dropdown = button.closest('.kebab-menu-dropdown');
                     const contentParent = dropdown?.closest('.process-content');
                     if(dropdown) dropdown.classList.add('hidden');
                     if(contentParent) contentParent.style.overflow = 'hidden'; // Restaura overflow
                 }
            }
        });
     } else console.error("#absences-list não encontrado.");
 }

 /** Helper: Abre/Fecha Acordeão BA */
 function toggleAbsenceAccordion(processId, headerElement) {
    const content = document.getElementById(`content-${processId}`);
    const icon = headerElement?.querySelector('i.fa-chevron-down');
    if (!content) return;
    const isHidden = !content.style.maxHeight || content.style.maxHeight === '0px';
    if (isHidden) {
        content.style.maxHeight = `${content.scrollHeight}px`;
        // Não mexer no overflow aqui, o kebab controla
    } else {
        content.style.maxHeight = null; // Fecha
        content.style.overflow = 'hidden'; // Garante hidden ao fechar
        // Fecha menus kebab abertos dentro dele
        content.querySelectorAll('.kebab-menu-dropdown:not(.hidden)').forEach(d => d.classList.add('hidden'));
    }
    icon?.classList.toggle('rotate-180', isHidden);
}

/** Helper: Abre/Fecha Kebab Menu BA */
function toggleAbsenceKebabMenu(kebabButton) {
    const dropdown = kebabButton.nextElementSibling;
    if (!dropdown?.classList.contains('kebab-menu-dropdown')) return;

    // Fecha outros menus primeiro
    document.querySelectorAll('#absences-list .kebab-menu-dropdown').forEach(d => {
        if (d !== dropdown && !d.classList.contains('hidden')) {
            d.classList.add('hidden');
            // Restaura overflow do irmão
            const otherParent = d.closest('.process-content');
            if(otherParent) otherParent.style.overflow = 'hidden';
        }
    });

    const contentParent = kebabButton.closest('.process-content');
    if (dropdown.classList.contains('hidden')) {
        if (contentParent) contentParent.style.overflow = 'visible';
        dropdown.classList.remove('hidden');
    } else {
        dropdown.classList.add('hidden');
        if (contentParent) contentParent.style.overflow = 'hidden';
    }
}


/** Edita Ocorrência (será movido) */
function handleEditOccurrence(groupId) {
     const incident = getFilteredOccurrences().get(groupId); // Usa a função de ui.js
     if (incident) openOccurrenceModal(incident);
     else showToast('Incidente não encontrado para edição.');
 }
/** Prepara Exclusão BA (será movido) */
 function handleDeleteAbsenceSetup(id) {
     const actionToDelete = state.absences.find(a => a.id === id);
     if (!actionToDelete) return showToast("Ação não encontrada.");

     const sequence = ['tentativa_1', 'tentativa_2', 'tentativa_3', 'visita', 'encaminhamento_ct', 'analise'];
     const processActions = state.absences
         .filter(a => a.processId === actionToDelete.processId)
         .sort((a,b) => sequence.indexOf(a.actionType) - sequence.indexOf(b.actionType));
     const lastActionInProcess = processActions[processActions.length - 1];

     if (actionToDelete.id !== lastActionInProcess.id) {
          return showToast(`Exclua a etapa mais recente ('${actionDisplayTitles[lastActionInProcess.actionType]}') primeiro.`);
     }

     let message = '';
     if (actionToDelete.actionType === 'encaminhamento_ct') {
         const analiseAction = processActions.find(a => a.actionType === 'analise');
         if (analiseAction) {
              message = 'A Análise associada também será excluída. Continuar?';
              state.recordToDelete = { type: 'absence-cascade', ctId: id, analiseId: analiseAction.id };
         } else {
              message = 'Tem certeza que deseja excluir este Encaminhamento ao CT?';
              state.recordToDelete = { type: 'absence', id: id };
         }
     } else {
         message = `Tem certeza que deseja excluir "${actionDisplayTitles[actionToDelete.actionType]}"?`;
         state.recordToDelete = { type: 'absence', id: id };
     }

     const deleteMessageElem = document.getElementById('delete-confirm-message');
     if (deleteMessageElem) deleteMessageElem.textContent = message;
     openModal(dom.deleteConfirmModal);
}
/** Edita BA (será movido) */
function handleEditAbsence(id) {
     const data = state.absences.find(a => a.id === id);
     if (!data) return showToast("Ação não encontrada.");
     const student = state.students.find(s => s.matricula === data.studentId);
     if (!student) return showToast("Aluno não encontrado.");
     openAbsenceModalForStudent(student, data.actionType, data);
 }
/** Envia CT (será movido) */
async function handleSendToCT(id) {
    const visitAction = state.absences.find(a => a.id === id && a.actionType === 'visita');
    if (!visitAction) return showToast("Ação de visita não encontrada.");

    const existingCTAction = state.absences.find(a => a.processId === visitAction.processId && a.actionType === 'encaminhamento_ct');
    if (existingCTAction) {
         if (existingCTAction.oficioNumber) {
            showToast(`Encaminhamento já existe (Ofício ${existingCTAction.oficioNumber}/${existingCTAction.oficioYear}). A visualizar.`);
            generateAndShowOficio(existingCTAction);
         } else { showToast("Encaminhamento já existe, mas sem nº de ofício."); handleEditAbsence(existingCTAction.id); } // Abre edição
         return;
    }

    const oficioNumberInput = prompt("Insira o número do ofício para o Conselho Tutelar:");
    if (!oficioNumberInput?.trim()) return showToast("Número do ofício cancelado ou inválido.");

    const oficioNumber = oficioNumberInput.trim();
    const oficioYear = new Date().getFullYear();
    const student = state.students.find(s => s.matricula === visitAction.studentId);
    if (!student) return showToast("Aluno não encontrado.");

    const { currentCycleActions } = logic.getStudentProcessInfo(student.matricula);
    const firstAction = currentCycleActions.find(a => a.periodoFaltasStart);

    const dataForCt = {
        studentId: student.matricula, actionType: 'encaminhamento_ct', processId: visitAction.processId,
        ctSentDate: new Date().toISOString().split('T')[0], oficioNumber, oficioYear,
        periodoFaltasStart: firstAction?.periodoFaltasStart || null,
        periodoFaltasEnd: firstAction?.periodoFaltasEnd || null,
        absenceCount: firstAction?.absenceCount || null,
        ctFeedback: null, ctReturned: null,
    };

    // Gera o ofício para visualização ANTES de salvar
    generateAndShowOficio(dataForCt);

    // Pergunta se deseja salvar após visualizar
    // Usar confirmação customizada se disponível
    const saveConfirmed = window.confirm ? window.confirm(`Ofício ${oficioNumber}/${oficioYear} gerado. Deseja salvar este registro de encaminhamento?`) : true;

    if (saveConfirmed) {
        const historyAction = `Encaminhamento ao CT registado (Ofício ${oficioNumber}/${oficioYear}).`;
        try {
            await addRecordWithHistory('absence', dataForCt, historyAction, state.userEmail);
            showToast(`Registro de Encaminhamento salvo.`);
        } catch(err) {
            console.error("Erro ao salvar encaminhamento:", err);
            showToast("Erro ao salvar o registro de encaminhamento.");
        }
    } else {
         showToast("Registro de Encaminhamento não salvo.");
    }
 }
/** Visualiza Ofício (será movido) */
function handleViewOficio(id) {
     const ctAction = state.absences.find(a => a.id === id && a.actionType === 'encaminhamento_ct');
     if (ctAction?.oficioNumber) generateAndShowOficio(ctAction);
     else if (ctAction) showToast("Registro sem número de ofício.");
     else showToast("Registro de encaminhamento não encontrado.");
 }
/** Nova Ação BA (será movido) */
function handleNewAbsenceFromHistory(studentId) {
    const student = state.students.find(s => s.matricula === studentId);
    if (student) handleNewAbsenceAction(student);
    else showToast("Aluno não encontrado.");
}

