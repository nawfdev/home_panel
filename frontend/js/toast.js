// Global API helper with credentials
async function api(url, options = {}) {
    const defaultOptions = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    };

    const res = await fetch('/api' + url, { ...defaultOptions, ...options });

    if (res.status === 401) {
        throw new Error('Unauthorized');
    }

    return res.json();
}

// Toast Notification System
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
toastContainer.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2';
document.body.appendChild(toastContainer);

function showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };

    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        warning: 'bg-yellow-600',
        info: 'bg-blue-600'
    };

    toast.className = `${colors[type] || colors.info} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[300px] max-w-md transform translate-x-full transition-transform duration-300`;
    toast.innerHTML = `
        <i class="fas ${icons[type] || icons.info} text-xl"></i>
        <span class="flex-1">${message}</span>
        <button class="text-white hover:text-gray-200" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    toastContainer.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full');
    });

    // Auto remove
    if (duration > 0) {
        setTimeout(() => {
            toast.classList.add('translate-x-full');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    return toast;
}

// Override native alert
window.originalAlert = window.alert;
window.alert = function (message) {
    // Determine type based on message content
    let type = 'info';
    if (message.includes('Error') || message.includes('Failed') || message.includes('❌')) {
        type = 'error';
    } else if (message.includes('success') || message.includes('Success') || message.includes('✅') || message.includes('saved') || message.includes('created') || message.includes('Copied')) {
        type = 'success';
    } else if (message.includes('Warning') || message.includes('⚠️') || message.includes('required')) {
        type = 'warning';
    }

    showToast(message, type);
};

// Confirm dialog replacement (callback-based)
function showConfirm(message, onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    overlay.innerHTML = `
        <div class="bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-2xl">
            <div class="flex items-start gap-3 mb-4">
                <i class="fas fa-question-circle text-yellow-500 text-2xl mt-1"></i>
                <p class="text-white">${message}</p>
            </div>
            <div class="flex gap-3 justify-end">
                <button class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition" id="confirm-cancel">
                    Cancel
                </button>
                <button class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition" id="confirm-ok">
                    Confirm
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#confirm-ok').addEventListener('click', () => {
        overlay.remove();
        if (onConfirm) onConfirm();
    });

    overlay.querySelector('#confirm-cancel').addEventListener('click', () => {
        overlay.remove();
        if (onCancel) onCancel();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
            if (onCancel) onCancel();
        }
    });
}

// Promise-based confirm (replacement for native confirm)
function confirmAsync(message) {
    return new Promise((resolve) => {
        showConfirm(message, () => resolve(true), () => resolve(false));
    });
}

// Override native confirm() - NOTE: This makes confirm() async!
// Code using confirm() will need to be updated to use await or .then()
window.originalConfirm = window.confirm;
// We can't fully override confirm() to be async, so we provide confirmAsync instead
