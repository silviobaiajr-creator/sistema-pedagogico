// =================================================================================
// ARQUIVO: students.js
// VERSÃO: 2.1 (Com Paginação e Busca Server-Side)

import { state, dom } from './state.js';
import { setDoc, doc, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStudentsCollectionRef, loadStudentsPaginated, searchStudentsByName } from './firestore.js'; 
import { db } from './firebase.js'; 
import { showToast, openModal, loadScript } from './utils.js'; 

// Variável local para controle de debounce da pesquisa
let searchTimeout = null;

/**
 * Renderiza a lista de alunos no modal "Gerir Alunos".
 * Agora suporta PAGINAÇÃO (append) e cria a barra de busca dinamicamente.
 * @param {boolean} append - Se true, adiciona linhas ao final em vez de limpar a tabela.
 */
const renderStudentsList = (append = false) => {
    const tableBody = dom.studentsListTable;
    if (!tableBody) return; 

    // --- 1. INJEÇÃO DA BARRA DE PESQUISA (Se não existir) ---
    // Como não alteramos o HTML, criamos o input via JS e inserimos antes da tabela.
    let searchContainer = document.getElementById('student-manager-search-container');
    if (!searchContainer) {
        const tableContainer = tableBody.closest('.overflow-y-auto').parentElement;
        searchContainer = document.createElement('div');
        searchContainer.id = 'student-manager-search-container';
        searchContainer.className = 'mb-4 px-1';
        searchContainer.innerHTML = `
            <div class="relative">
                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <i class="fas fa-search text-gray-400"></i>
                </div>
                <input type="text" id="student-manager-search" 
                    class="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 sm:text-sm" 
                    placeholder="Pesquisar aluno no servidor (nome)...">
            </div>
        `;
        tableContainer.insertBefore(searchContainer, tableContainer.firstChild);
        
        // Adiciona o listener de busca
        const searchInput = searchContainer.querySelector('#student-manager-search');
        searchInput.addEventListener('input', handleServerSideSearch);
    }

    // --- 2. RENDERIZAÇÃO DA LISTA ---
    
    if (!append) {
        tableBody.innerHTML = ''; // Limpa se não for paginação (append)
    } else {
        // Remove o botão "Carregar Mais" antigo se existir, para adicionar os novos dados e recriar o botão no fim
        const oldLoadMore = document.getElementById('load-more-row');
        if (oldLoadMore) oldLoadMore.remove();
    }

    // Renderiza as linhas
    state.students.forEach(student => {
        // Evita duplicatas visuais se o estado tiver sido poluído
        if (document.getElementById(`row-${student.matricula}`)) return;

        const row = document.createElement('tr');
        row.id = `row-${student.matricula}`;
        row.innerHTML = `
            <td class="px-4 py-2 text-sm text-gray-900">${student.name}</td>
            <td class="px-4 py-2 text-sm text-gray-500">${student.class || '-'}</td>
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

    // --- 3. BOTÃO "CARREGAR MAIS" ---
    // Só mostra se houver mais páginas e se NÃO estivermos numa busca filtrada (busca reseta paginação)
    const searchInput = document.getElementById('student-manager-search');
    const isSearching = searchInput && searchInput.value.trim().length > 0;

    if (state.pagination.hasMore && !isSearching) {
        const loadMoreRow = document.createElement('tr');
        loadMoreRow.id = 'load-more-row';
        loadMoreRow.innerHTML = `
            <td colspan="3" class="px-4 py-3 text-center">
                <button id="btn-load-more-students" class="text-sky-600 hover:text-sky-800 font-semibold text-sm flex items-center justify-center w-full focus:outline-none">
                    ${state.pagination.isLoading ? '<i class="fas fa-spinner fa-spin mr-2"></i> Carregando...' : '<i class="fas fa-plus-circle mr-2"></i> Carregar Mais Alunos'}
                </button>
            </td>
        `;
        tableBody.appendChild(loadMoreRow);

        // Listener do botão
        document.getElementById('btn-load-more-students').addEventListener('click', handleLoadMore);
    } else if (state.students.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="3" class="px-4 py-8 text-center text-gray-500">Nenhum aluno encontrado.</td></tr>`;
    }
};

/**
 * Lida com o clique em "Carregar Mais".
 */
async function handleLoadMore() {
    if (state.pagination.isLoading || !state.pagination.hasMore) return;

    state.pagination.isLoading = true;
    renderStudentsList(true); // Re-renderiza para mostrar o spinner

    try {
        // Busca a próxima página
        const { students: newStudents, lastVisible } = await loadStudentsPaginated(state.pagination.lastVisible, 50);

        if (newStudents.length > 0) {
            // Adiciona ao estado
            state.students = [...state.students, ...newStudents];
            state.pagination.lastVisible = lastVisible;
            // Se vieram menos de 50, acabou a lista
            state.pagination.hasMore = newStudents.length === 50;
        } else {
            state.pagination.hasMore = false;
        }

    } catch (error) {
        console.error("Erro ao carregar mais alunos:", error);
        showToast("Erro ao carregar mais alunos.");
    } finally {
        state.pagination.isLoading = false;
        renderStudentsList(true); // Atualiza a tabela
    }
}

/**
 * Lida com a busca no servidor (Debounced).
 */
function handleServerSideSearch(e) {
    const term = e.target.value;

    // Limpa timeout anterior
    if (searchTimeout) clearTimeout(searchTimeout);

    // Espera 500ms após o usuário parar de digitar
    searchTimeout = setTimeout(async () => {
        const tableBody = dom.studentsListTable;
        
        if (!term) {
            // Se limpou a busca, recarrega a página inicial padrão
            tableBody.innerHTML = '<tr><td colspan="3" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i> Restaurando lista...</td></tr>';
            state.pagination.lastVisible = null; // Reseta cursor
            state.pagination.hasMore = true;
            
            try {
                const { students, lastVisible } = await loadStudentsPaginated(null, 50);
                state.students = students;
                state.pagination.lastVisible = lastVisible;
                state.pagination.hasMore = students.length === 50;
                renderStudentsList(false);
            } catch (err) { console.error(err); }
            return;
        }

        // Mostra loading
        tableBody.innerHTML = '<tr><td colspan="3" class="text-center py-4"><i class="fas fa-spinner fa-spin"></i> Buscando no servidor...</td></tr>';

        try {
            const results = await searchStudentsByName(term);
            state.students = results;
            // Busca desativa paginação padrão
            state.pagination.hasMore = false; 
            renderStudentsList(false);
        } catch (error) {
            console.error("Erro na busca:", error);
            showToast("Erro ao buscar alunos.");
        }
    }, 500); // 500ms delay
}

/**
 * Reseta o formulário de adição/edição de aluno.
 */
const resetStudentForm = () => {
    document.getElementById('student-form-title').textContent = 'Adicionar Novo Aluno';
    dom.studentForm.reset(); 
    document.getElementById('student-id-input').value = '';
    document.getElementById('student-matricula-input').readOnly = false;
    document.getElementById('student-matricula-input').classList.remove('bg-gray-100');
    dom.cancelEditStudentBtn.classList.add('hidden'); 
};

/**
 * Lida com o upload do ficheiro CSV de alunos.
 */
async function handleCsvUpload() {
    const fileInput = dom.csvFile; 
    const feedbackDiv = dom.csvFeedback; 

    if (fileInput.files.length === 0) return showToast("Por favor, selecione um ficheiro CSV.");

    try {
        if (typeof window.Papa === 'undefined') {
            feedbackDiv.innerHTML = `<p class="text-sky-500">A carregar biblioteca de CSV...</p>`; 
            const papaScriptUrl = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js';
            await loadScript(papaScriptUrl);
            if (typeof window.Papa === 'undefined') throw new Error("Falha ao carregar PapaParse dinamicamente.");
            feedbackDiv.innerHTML = '';
        }

        window.Papa.parse(fileInput.files[0], {
            header: true,
            skipEmptyLines: true,
            transformHeader: header => header.toLowerCase().trim().replace(/\s+/g, ''),
            complete: async (results) => {
                if (!results.meta || !results.meta.fields) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Erro: Cabeçalhos inválidos.</p>`;
                    return;
                }

                const requiredHeaders = ['matricula', 'nome', 'turma', 'endereco', 'contato', 'resp1', 'resp2'];
                const hasAllHeaders = requiredHeaders.every(h => results.meta.fields.includes(h));
                if (!hasAllHeaders) {
                    feedbackDiv.innerHTML = `<p class="text-red-500">Faltam colunas obrigatórias: ${requiredHeaders.join(', ')}.</p>`;
                    return;
                }

                const validStudents = results.data.map(row => ({
                    matricula: row.matricula ? String(row.matricula).trim() : '',
                    name: row.nome ? String(row.nome).trim() : '',
                    class: row.turma || '',
                    endereco: row.endereco || '',
                    contato: row.contato || '',
                    resp1: row.resp1 || '',
                    resp2: row.resp2 || ''
                })).filter(s => s.name && s.matricula);

                if (validStudents.length === 0) {
                     feedbackDiv.innerHTML = `<p class="text-red-500">Nenhum aluno válido encontrado.</p>`;
                     return;
                }

                const BATCH_SIZE = 450; 
                const chunks = [];
                for (let i = 0; i < validStudents.length; i += BATCH_SIZE) {
                    chunks.push(validStudents.slice(i, i + BATCH_SIZE));
                }

                feedbackDiv.innerHTML = `<p class="text-sky-600">Processando ${validStudents.length} alunos...</p>`;

                const collectionRef = getStudentsCollectionRef();
                let processedCount = 0;

                try {
                    for (const chunk of chunks) {
                        const batch = writeBatch(db);
                        chunk.forEach(student => {
                            const docRef = doc(collectionRef, student.matricula);
                            batch.set(docRef, student);
                        });
                        await batch.commit();
                        processedCount += chunk.length;
                        feedbackDiv.innerHTML = `<p class="text-sky-600">Salvo lote ${processedCount}/${validStudents.length}...</p>`;
                    }

                    // Recarrega a lista PAGINADA (reseta para página 1)
                    const { students, lastVisible } = await loadStudentsPaginated(null, 50);
                    state.students = students;
                    state.pagination = { lastVisible, hasMore: students.length === 50, isLoading: false };
                    
                    renderStudentsList(false);
                    showToast(`${processedCount} alunos importados!`);
                    fileInput.value = '';
                    feedbackDiv.innerHTML = `<p class="text-green-600 font-bold">Sucesso!</p>`;
                    setTimeout(() => feedbackDiv.innerHTML = '', 5000);

                } catch(error) {
                    console.error("Erro no batch:", error);
                    let msg = error.message;
                    if (error.code === 'permission-denied') msg = "Erro de Permissão (verifique firestore.rules).";
                    feedbackDiv.innerHTML = `<p class="text-red-500 font-bold">${msg}</p>`;
                }
            },
            error: (error) => {
                feedbackDiv.innerHTML = `<p class="text-red-500">Erro no CSV: ${error.message}</p>`;
            }
        });

    } catch (error) {
        console.error(error);
        showToast("Erro ao carregar biblioteca CSV.");
    }
}

/**
 * Lida com a submissão do formulário de adição/edição.
 */
async function handleStudentFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('student-id-input').value; 
    const matricula = document.getElementById('student-matricula-input').value.trim();
    const name = document.getElementById('student-name-input').value.trim();
    
    if (!matricula || !name) return showToast("Matrícula e Nome são obrigatórios.");

    const studentData = {
        matricula, name,
        class: document.getElementById('student-class-input').value.trim(),
        endereco: document.getElementById('student-endereco-input').value.trim(),
        contato: document.getElementById('student-contato-input').value.trim(),
        resp1: document.getElementById('student-resp1-input').value.trim(),
        resp2: document.getElementById('student-resp2-input').value.trim()
    };

    try {
        const collectionRef = getStudentsCollectionRef();

        if (id && id !== matricula) {
            await setDoc(doc(collectionRef, matricula), studentData);
            await deleteDoc(doc(collectionRef, id));
        } else {
            await setDoc(doc(collectionRef, matricula), studentData, { merge: true });
        }

        // Atualiza o estado local apenas se o aluno estiver na lista visível atual
        // Caso contrário, não faz nada (o user pode buscá-lo depois)
        if (id) {
            const index = state.students.findIndex(s => s.matricula === id);
            if (index > -1) state.students.splice(index, 1); 
        }
        
        // Adiciona ao topo da lista para feedback visual imediato (opcional, mas bom para UX)
        const existingIndex = state.students.findIndex(s => s.matricula === matricula);
        if (existingIndex > -1) state.students[existingIndex] = studentData;
        else state.students.unshift(studentData); // Adiciona no topo

        renderStudentsList(false); 
        resetStudentForm(); 
        showToast(`Aluno ${id ? 'atualizado' : 'adicionado'} com sucesso.`);
        
    } catch(error) {
        console.error("Erro ao salvar:", error);
        showToast(error.code === 'permission-denied' ? "Erro de Permissão." : "Erro ao salvar.");
    }
}

/**
 * Lida com cliques nos botões de editar e excluir.
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
            document.getElementById('student-name-input').value = student.name;
            document.getElementById('student-class-input').value = student.class || '';
            document.getElementById('student-endereco-input').value = student.endereco || '';
            document.getElementById('student-contato-input').value = student.contato || '';
            document.getElementById('student-resp1-input').value = student.resp1 || '';
            document.getElementById('student-resp2-input').value = student.resp2 || '';
            dom.cancelEditStudentBtn.classList.remove('hidden'); 
        }
        return;
    }

    const deleteBtn = e.target.closest('.delete-student-btn');
    if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        const student = state.students.find(s => s.matricula === id);
        
        if (student && confirm(`Tem a certeza que quer remover o aluno "${student.name}"?`)) {
            try {
                await deleteDoc(doc(getStudentsCollectionRef(), id));
                state.students = state.students.filter(s => s.matricula !== id);
                renderStudentsList(false); 
                showToast("Aluno removido com sucesso.");
            } catch(error) {
                console.error(error);
                showToast("Erro ao remover aluno.");
            }
        }
    }
}

export const initStudentListeners = () => {
    const manageStudentsBtn = document.getElementById('manage-students-btn');
    const { studentsModal, uploadCsvBtn, studentForm, cancelEditStudentBtn, studentsListTable } = dom;

    if (manageStudentsBtn && studentsModal) {
        manageStudentsBtn.addEventListener('click', () => {
            // Ao abrir o modal, renderiza a lista que já foi carregada no início (paginada)
            // Ou recarrega se estiver vazia
            if (state.students.length === 0) {
                handleLoadMore(); // Tenta carregar primeira página
            } else {
                renderStudentsList(false); 
            }
            openModal(studentsModal);
        });
    }

    if (uploadCsvBtn) uploadCsvBtn.addEventListener('click', handleCsvUpload);
    if (studentForm) studentForm.addEventListener('submit', handleStudentFormSubmit);
    if (cancelEditStudentBtn) cancelEditStudentBtn.addEventListener('click', resetStudentForm);
    if (studentsListTable) studentsListTable.addEventListener('click', handleStudentTableActions);
};