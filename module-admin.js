// =================================================================================
// ARQUIVO: module-admin.js
// RESPONSABILIDADE: Orquestrar a funcionalidade de gerenciamento de alunos
// (lista, formulário, upload CSV) e configurações da escola.
// =================================================================================

import { state, dom } from './state.js';
import { showToast, openModal } from './utils.js';
import { saveSchoolConfig } from './firestore.js'; // Para salvar config
import { getStudentsDocRef } from './firestore.js'; // Para salvar/excluir alunos
import { setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; // Para salvar/excluir alunos

// --- INICIALIZAÇÃO DO MÓDULO ---

/**
 * Inicializa o módulo de Admin, configurando os event listeners necessários.
 */
export const initAdmin = () => {
    console.log("Módulo de Admin (module-admin.js) Inicializado."); // Log para depuração

    // Botões no Cabeçalho
    if (dom.settingsBtn) {
        dom.settingsBtn.addEventListener('click', openSettingsModal);
    } else {
        console.error("Botão #settings-btn não encontrado.");
    }

    if (dom.manageStudentsBtn) {
        dom.manageStudentsBtn.addEventListener('click', () => { 
            renderStudentsList(); // Renderiza a lista ao abrir o modal
            openModal(dom.studentsModal); 
        });
    } else {
        console.error("Botão #manage-students-btn não encontrado.");
    }

    // Formulário de Configurações
    if (dom.settingsForm) {
        dom.settingsForm.addEventListener('submit', handleSettingsSubmit);
    } else {
        console.error("Formulário #settings-form não encontrado.");
    }

    // Modal de Gerenciamento de Alunos
    if (dom.studentsModal) {
        // Listener para o botão de Upload CSV
        const uploadBtn = dom.studentsModal.querySelector('#upload-csv-btn');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', handleCsvUpload);
        } else {
             console.error("Botão #upload-csv-btn não encontrado.");
        }

        // Listener para o formulário de Adicionar/Editar Aluno
        const studentForm = dom.studentsModal.querySelector('#student-form');
        if (studentForm) {
            studentForm.addEventListener('submit', handleStudentFormSubmit);
        } else {
             console.error("Formulário #student-form não encontrado.");
        }

        // Listener para o botão Cancelar Edição
        const cancelEditBtn = dom.studentsModal.querySelector('#cancel-edit-student-btn');
        if(cancelEditBtn) {
            cancelEditBtn.addEventListener('click', resetStudentForm);
        } else {
             console.error("Botão #cancel-edit-student-btn não encontrado.");
        }

        // Listener para a Tabela de Alunos (usando delegação de eventos)
        if (dom.studentsListTable) {
            dom.studentsListTable.addEventListener('click', handleStudentTableActions);
        } else {
             console.error("Tabela #students-list-table não encontrada.");
        }
    } else {
         console.error("Modal #students-modal não encontrado.");
    }
};

// --- HANDLERS DE EVENTOS ---

/**
 * Lida com a submissão do formulário de configurações.
 * (Movido de main.js)
 */
async function handleSettingsSubmit(e) {
    e.preventDefault();
    const data = {
        schoolName: document.getElementById('school-name-input').value.trim(),
        city: document.getElementById('school-city-input').value.trim(),
        schoolLogoUrl: document.getElementById('school-logo-input').value.trim() || null // Salva null se vazio
    };

    if (!data.schoolName) {
        return showToast("O nome da escola é obrigatório.");
    }

    try {
        await saveSchoolConfig(data);
        state.config = data; // Atualiza o estado local
        if (dom.headerSchoolName) {
            dom.headerSchoolName.textContent = data.schoolName; // Atualiza a UI imediatamente
        }
        showToast('Configurações salvas com sucesso!');
        // closeModal(dom.settingsModal); // Fechar modal é gerenciado pelo main.js/setupModalCloseButtons
    } catch (error) {
        console.error("Erro ao salvar configurações:", error);
        showToast('Erro ao salvar as configurações.');
    }
}

/**
 * Lida com a submissão do formulário de adição/edição de aluno.
 * (Movido de main.js)
 */
async function handleStudentFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('student-id-input').value; // Usado para saber se é edição
    const matricula = document.getElementById('student-matricula-input').value.trim();
    const name = document.getElementById('student-name-input').value.trim();
    
    // Validações básicas
    if (!matricula || !name) {
         return showToast("Matrícula e Nome Completo são obrigatórios.");
    }
    if (!document.getElementById('student-class-input').value.trim()) {
         return showToast("A Turma é obrigatória.");
    }
     if (!document.getElementById('student-resp1-input').value.trim()) {
         return showToast("O Responsável 1 é obrigatório.");
    }
    
    let updatedList = [...state.students]; // Cria cópia da lista atual
    
    // Prepara os dados do aluno
    const studentData = { 
        matricula, name, 
        class: document.getElementById('student-class-input').value.trim(),
        endereco: document.getElementById('student-endereco-input').value.trim() || '', // Garante string vazia se nulo
        contato: document.getElementById('student-contato-input').value.trim() || '',
        resp1: document.getElementById('student-resp1-input').value.trim(),
        resp2: document.getElementById('student-resp2-input').value.trim() || ''
    };
    
    if (id) {
        // Modo Edição: Atualiza o aluno existente
        const index = updatedList.findIndex(s => s.matricula === id);
        if (index > -1) {
            // Verifica se a matrícula (chave primária) foi alterada E se já existe
            if (id !== matricula && updatedList.some((s, i) => i !== index && s.matricula === matricula)) {
                 return showToast("Erro: A nova matrícula já existe para outro aluno.");
            }
            updatedList[index] = { ...studentData, matricula: matricula }; // Atualiza com a nova matrícula se mudou
        } else {
            return showToast("Erro: Aluno não encontrado para edição."); // Segurança
        }
    } else {
        // Modo Adição: Verifica se a matrícula já existe
        if (updatedList.some(s => s.matricula === matricula)) {
             return showToast("Erro: Matrícula já existe.");
        }
        updatedList.push(studentData);
    }

    try {
        // Salva a lista COMPLETA no Firestore (sobrescreve)
        await setDoc(getStudentsDocRef(), { list: updatedList }); 
        state.students = updatedList; // Atualiza o estado local
        renderStudentsList(); // Re-renderiza a tabela no modal
        resetStudentForm(); // Limpa o formulário
        showToast(`Aluno ${id ? 'atualizado' : 'adicionado'} com sucesso.`);
    } catch(error) {
        console.error("Erro ao salvar dados do aluno:", error);
        showToast("Erro ao salvar dados do aluno.");
    }
}

/**
 * Lida com as ações na tabela de alunos (Editar, Excluir).
 * (Movido de main.js)
 */
async function handleStudentTableActions(e) {
    const editBtn = e.target.closest('.edit-student-btn');
    if (editBtn) {
        const id = editBtn.dataset.id; // ID aqui é a MATRÍCULA atual do aluno na linha
        const student = state.students.find(s => s.matricula === id);
        if (student) {
            // Preenche o formulário para edição
            document.getElementById('student-form-title').textContent = 'Editar Aluno';
            document.getElementById('student-id-input').value = student.matricula; // Guarda a matrícula ORIGINAL para busca
            document.getElementById('student-matricula-input').value = student.matricula;
            // document.getElementById('student-matricula-input').readOnly = true; // Permite editar matrícula agora
            // document.getElementById('student-matricula-input').classList.add('bg-gray-100');
            document.getElementById('student-name-input').value = student.name;
            document.getElementById('student-class-input').value = student.class;
            document.getElementById('student-endereco-input').value = student.endereco || '';
            document.getElementById('student-contato-input').value = student.contato || '';
            document.getElementById('student-resp1-input').value = student.resp1;
            document.getElementById('student-resp2-input').value = student.resp2 || '';
            document.getElementById('cancel-edit-student-btn').classList.remove('hidden'); // Mostra botão Cancelar
             // Foca no campo nome para facilitar a edição
            document.getElementById('student-name-input').focus(); 
        }
        return; // Impede que o clique no botão de editar também dispare o de excluir
    }

    const deleteBtn = e.target.closest('.delete-student-btn');
    if (deleteBtn) {
        const id = deleteBtn.dataset.id; // Matrícula do aluno a excluir
        const student = state.students.find(s => s.matricula === id);
        if (student && confirm(`Tem a certeza que quer remover o aluno "${student.name}"? Esta ação não pode ser desfeita.`)) {
            const updatedList = state.students.filter(s => s.matricula !== id);
            try {
                await setDoc(getStudentsDocRef(), { list: updatedList }); // Salva a lista sem o aluno
                state.students = updatedList; // Atualiza estado local
                renderStudentsList(); // Re-renderiza a tabela
                 resetStudentForm(); // Garante que o formulário não fique com dados do aluno excluído
                showToast("Aluno removido com sucesso.");
            } catch(error) {
                console.error("Erro ao remover aluno:", error);
                // Usar getFirestoreErrorMessage se existir globalmente, senão mensagem genérica
                // showToast(getFirestoreErrorMessage(error.code) || "Erro ao remover aluno."); 
                showToast("Erro ao remover aluno.");
            }
        }
    }
}


// --- FUNÇÕES DE UPLOAD CSV (com carregamento robusto) ---

let papaLoadingPromise = null; // Guarda a promessa de carregamento

/**
 * Garante que a biblioteca PapaParse esteja carregada antes de usá-la.
 * @returns {Promise<boolean>} Resolve true se carregado, rejeita em caso de erro.
 */
function loadPapaParser() {
    if (typeof window.Papa !== 'undefined') {
        return Promise.resolve(true); // Já carregado
    }
    if (papaLoadingPromise) {
        return papaLoadingPromise; // Já está a carregar
    }

    console.log("PapaParse não encontrado, a iniciar carregamento dinâmico..."); // Log
    const feedbackDiv = document.getElementById('csv-feedback');
    if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-blue-500">A carregar biblioteca de CSV...</p>`;

    papaLoadingPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/paparse.min.js';
        script.async = true;
        script.onload = () => {
            console.log("PapaParse carregado com sucesso."); // Log
            if(feedbackDiv) feedbackDiv.innerHTML = ''; // Limpa feedback
            resolve(true);
        };
        script.onerror = (error) => {
            console.error("Erro ao carregar PapaParse:", error); // Log
            if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-red-500">Erro ao carregar a biblioteca necessária para ler o CSV.</p>`;
            papaLoadingPromise = null; // Permite tentar carregar novamente
            reject(new Error("Falha ao carregar PapaParse."));
        };
        document.body.appendChild(script);
    });
    return papaLoadingPromise;
}

/**
 * Lida com o upload do arquivo CSV de alunos.
 * (Movido de main.js, agora com carregamento robusto)
 */
async function handleCsvUpload() {
    const fileInput = document.getElementById('csv-file');
    const feedbackDiv = document.getElementById('csv-feedback');
    const uploadBtn = document.getElementById('upload-csv-btn');

    if (fileInput.files.length === 0) {
         return showToast("Por favor, selecione um ficheiro CSV.");
    }
    const file = fileInput.files[0];

    // Desabilita botão e mostra feedback
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>A Carregar...';
    if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-gray-500">A processar o ficheiro...</p>`;

    try {
        // Garante que PapaParse está carregado
        await loadPapaParser(); 

        // Agora podemos usar window.Papa com segurança
        window.Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            // Transforma cabeçalhos para minúsculas, sem espaços e acentos
            transformHeader: header => header.toLowerCase().trim()
                                           .replace(/\s+/g, '')
                                           .normalize("NFD").replace(/[\u0300-\u036f]/g, ""), 
            complete: async (results) => {
                // Cabeçalhos esperados (já normalizados)
                const requiredHeaders = ['matricula', 'nome', 'turma', 'endereco', 'contato', 'resp1', 'resp2'];
                const fileHeaders = results.meta.fields.map(h => h.toLowerCase().trim()
                                                                  .replace(/\s+/g, '')
                                                                  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")); 
                
                // Verifica se todos os cabeçalhos necessários estão presentes
                const missingHeaders = requiredHeaders.filter(h => !fileHeaders.includes(h));
                if (missingHeaders.length > 0) {
                    if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Faltam colunas no CSV. Necessário: ${missingHeaders.join(', ')}.</p>`;
                    resetUploadButton();
                    return;
                }

                // Processa os dados
                const newStudentList = results.data.map(row => {
                     // Mapeia usando os nomes normalizados
                     const normalizedRow = {};
                     for (const key in row) {
                         const normalizedKey = key.toLowerCase().trim()
                                                  .replace(/\s+/g, '')
                                                  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                         normalizedRow[normalizedKey] = row[key];
                     }
                     
                     return {
                        // Usa os nomes normalizados para buscar os dados
                        matricula: normalizedRow.matricula || '', 
                        name: normalizedRow.nome || '', // 'nome' em vez de 'name'
                        class: normalizedRow.turma || '', // 'turma' em vez de 'class'
                        endereco: normalizedRow.endereco || '', 
                        contato: normalizedRow.contato || '',
                        resp1: normalizedRow.resp1 || '', 
                        resp2: normalizedRow.resp2 || ''
                     };
                }).filter(s => s.matricula && s.name && s.class && s.resp1); // Validação mínima mais forte

                if (newStudentList.length === 0) {
                     if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-yellow-500">Nenhum aluno válido encontrado no ficheiro. Verifique os dados e os cabeçalhos.</p>`;
                     resetUploadButton();
                     return;
                }

                // Salva no Firestore
                try {
                    await setDoc(getStudentsDocRef(), { list: newStudentList });
                    state.students = newStudentList; // Atualiza estado local
                    renderStudentsList(); // Re-renderiza a tabela
                    showToast(`${newStudentList.length} alunos importados com sucesso! A lista anterior foi substituída.`);
                    fileInput.value = ''; // Limpa o input de ficheiro
                    if(feedbackDiv) feedbackDiv.innerHTML = ''; // Limpa feedback
                } catch(dbError) {
                    console.error("Erro ao salvar alunos no Firestore:", dbError);
                    if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-red-500">Erro ao salvar a nova lista de alunos no banco de dados.</p>`;
                    showToast("Erro ao salvar a nova lista de alunos.");
                } finally {
                    resetUploadButton();
                }
            },
            error: (err) => {
                 console.error("Erro ao parsear CSV:", err);
                 if(feedbackDiv) feedbackDiv.innerHTML = `<p class="text-red-500">Erro ao ler o ficheiro CSV: ${err.message}</p>`;
                 showToast("Erro ao processar o ficheiro CSV.");
                 resetUploadButton();
            }
        });
    } catch (loadError) {
        // Erro vindo do loadPapaParser()
        showToast(loadError.message); // Mostra a mensagem de erro do carregamento
        resetUploadButton();
    }
}

/** Helper para resetar o estado do botão de upload */
function resetUploadButton() {
     const uploadBtn = document.getElementById('upload-csv-btn');
     if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = 'Carregar CSV';
     }
}


// --- FUNÇÕES DE UI ESPECÍFICAS DE ADMIN ---

/**
 * Renderiza a lista de alunos no modal "Gerir Alunos".
 * (Movido de ui.js)
 */
function renderStudentsList() {
    const tableBody = dom.studentsListTable; // Usa a referência direta do dom
    if (!tableBody) {
        console.error("Elemento #students-list-table não encontrado para renderizar.");
        return; 
    }
    
    tableBody.innerHTML = ''; // Limpa a tabela antes de redesenhar.
    
    // Ordena alfabeticamente antes de renderizar
    state.students.sort((a,b) => a.name.localeCompare(b.name)).forEach(student => {
        const row = document.createElement('tr');
        // Adiciona classes para melhor espaçamento e alinhamento
        row.innerHTML = `
            <td class="px-4 py-2 text-sm text-gray-900 whitespace-nowrap">${student.name}</td>
            <td class="px-4 py-2 text-sm text-gray-500 whitespace-nowrap">${student.class}</td>
            <td class="px-4 py-2 text-right text-sm space-x-3 whitespace-nowrap">
                <button class="edit-student-btn text-yellow-600 hover:text-yellow-900" data-id="${student.matricula}" title="Editar ${student.name}">
                    <i class="fas fa-pencil-alt"></i>
                </button>
                <button class="delete-student-btn text-red-600 hover:text-red-900" data-id="${student.matricula}" title="Excluir ${student.name}">
                    <i class="fas fa-trash"></i>
                </button>
            </td>`;
        tableBody.appendChild(row);
    });

     // Mostra mensagem se a lista estiver vazia
     if (state.students.length === 0) {
         tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-gray-500 py-4">Nenhum aluno registado. Adicione um aluno ou importe via CSV.</td></tr>`;
     }
}


/**
 * Reseta o formulário de adição/edição de aluno para o estado inicial.
 * (Movido de ui.js)
 */
function resetStudentForm() {
    document.getElementById('student-form-title').textContent = 'Adicionar Novo Aluno';
    const form = document.getElementById('student-form');
    if(form) form.reset(); // Limpa os campos
    document.getElementById('student-id-input').value = ''; // Limpa o ID oculto
    
    // Libera o campo matrícula para adição
    const matriculaInput = document.getElementById('student-matricula-input');
    // matriculaInput.readOnly = false; // Não é mais readonly
    // matriculaInput.classList.remove('bg-gray-100');
    
    // Esconde o botão Cancelar
    document.getElementById('cancel-edit-student-btn').classList.add('hidden');
}

/**
 * Abre o modal de configurações e preenche com os dados atuais do estado.
 * (Movido de ui.js)
 */
function openSettingsModal() {
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.reset(); // Limpa o formulário
        // Preenche com os dados do estado global `state.config`
        document.getElementById('school-name-input').value = state.config.schoolName || '';
        document.getElementById('school-city-input').value = state.config.city || '';
        document.getElementById('school-logo-input').value = state.config.schoolLogoUrl || '';
    } else {
        console.error("Formulário #settings-form não encontrado para abrir modal.");
        return; // Não tenta abrir o modal se o formulário não existe
    }

    openModal(dom.settingsModal); // Usa a função utilitária para abrir
}

