        // API Configuration - can be overridden via environment variable during build
        const API_BASE_URL = (typeof process !== 'undefined' && process.env && process.env.API_BASE_URL) 
            ? process.env.API_BASE_URL 
            : 'https://dkc-secretshare-api.dom-kirby-creative.workers.dev';
        
        // Theme management
        function toggleTheme() {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            document.documentElement.setAttribute('data-theme', newTheme);
            document.getElementById('theme-icon').textContent = newTheme === 'dark' ? '☀️' : '🌙';
            localStorage.setItem('theme', newTheme);
        }

        // Initialize theme
        function initTheme() {
            const savedTheme = localStorage.getItem('theme') || 
                             (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            
            document.documentElement.setAttribute('data-theme', savedTheme);
            document.getElementById('theme-icon').textContent = savedTheme === 'dark' ? '☀️' : '🌙';
        }

        // CSRF Token Management
        let cachedCSRFToken = null;
        let csrfTokenExpiry = null;
        const CSRF_TOKEN_CACHE_DURATION = 25 * 60 * 1000; // 25 minutes (tokens expire after 30 minutes)

        /**
         * Get a CSRF token from the server
         * @returns {Promise<string>} The CSRF token
         */
        async function getCSRFToken() {
            // Check if we have a cached token that's still valid
            if (cachedCSRFToken && csrfTokenExpiry && Date.now() < csrfTokenExpiry) {
                return cachedCSRFToken;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });

                if (!response.ok) {
                    const errorMessage = handleApiError(response, 'Failed to get security token');
                    throw new Error(errorMessage);
                }

                const data = await response.json();
                
                if (!data.csrfToken) {
                    throw new Error('No security token received from server');
                }

                // Cache the token with expiry
                cachedCSRFToken = data.csrfToken;
                csrfTokenExpiry = Date.now() + CSRF_TOKEN_CACHE_DURATION;

                return cachedCSRFToken;
            } catch (error) {
                console.error('Error fetching CSRF token:', error);
                
                // Enhanced error message for network issues
                if (error.name === 'TypeError' && error.message.includes('fetch')) {
                    throw new Error('Unable to connect to server. Please check your internet connection.');
                }
                
                throw new Error(`Unable to get security token: ${error.message}`);
            }
        }

        /**
         * Clear cached CSRF token (useful when a token becomes invalid)
         */
        function clearCSRFToken() {
            cachedCSRFToken = null;
            csrfTokenExpiry = null;
        }

        /**
         * Make an API call with automatic CSRF token handling
         * @param {string} endpoint - The API endpoint to call
         * @param {Object} options - Fetch options (method, body, etc.)
         * @param {boolean} retry - Whether this is a retry attempt
         * @returns {Promise<Response>} The fetch response
         */
        async function apiCall(endpoint, options = {}, retry = false) {
            try {
                // Check network connectivity
                if (!navigator.onLine) {
                    throw new Error('No internet connection. Please check your network and try again.');
                }
                
                // Get CSRF token
                const csrfToken = await getCSRFToken();

                // Prepare headers
                const headers = {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                    ...options.headers,
                };

                // Make the API call with timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

                const response = await fetch(endpoint, {
                    ...options,
                    headers,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                // If we get a 403 (forbidden) and this isn't a retry, clear token and try again
                if (response.status === 403 && !retry) {
                    console.warn('CSRF token may be invalid, clearing cache and retrying...');
                    clearCSRFToken();
                    return await apiCall(endpoint, options, true);
                }

                return response;
            } catch (error) {
                console.error('API call failed:', error);
                
                // Enhanced error handling for different error types
                if (error.name === 'AbortError') {
                    throw new Error('Request timed out. Please try again.');
                } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
                    throw new Error('Unable to connect to server. Please check your internet connection.');
                } else if (error.message.includes('NetworkError')) {
                    throw new Error('Network error occurred. Please try again.');
                }
                
                throw error;
            }
        }

        // View management
        function showView(viewId) {
            const views = ['create-view', 'success-view', 'retrieve-view', 'error-view'];
            views.forEach(id => {
                const element = document.getElementById(id);
                if (id === viewId) {
                    element.classList.remove('hidden');
                    element.classList.add('fade-in');
                } else {
                    element.classList.add('hidden');
                    element.classList.remove('fade-in');
                }
            });
        }

        function showError(message, details = null) {
            const errorElement = document.getElementById('error-message');
            
            // Clean and format the error message
            const cleanMessage = formatErrorMessage(message);
            errorElement.textContent = cleanMessage;
            
            // Add details if provided
            if (details) {
                const detailsElement = document.createElement('div');
                detailsElement.style.marginTop = '1rem';
                detailsElement.style.fontSize = '0.9rem';
                detailsElement.style.opacity = '0.8';
                detailsElement.textContent = `Details: ${details}`;
                errorElement.appendChild(detailsElement);
            }
            
            showView('error-view');
            
            // Log error for debugging
            console.error('Application error:', message, details || '');
        }
        
        // Enhanced error message formatting
        function formatErrorMessage(message) {
            // Remove technical prefixes and make user-friendly
            let cleanMessage = message;
            
            // Network errors
            if (message.includes('fetch')) {
                cleanMessage = 'Unable to connect to the server. Please check your internet connection and try again.';
            } else if (message.includes('NetworkError') || message.includes('Failed to fetch')) {
                cleanMessage = 'Network connection failed. Please check your internet connection.';
            } else if (message.includes('TypeError: NetworkError')) {
                cleanMessage = 'Connection to server failed. Please try again later.';
            }
            
            // API errors
            else if (message.includes('Server error: 500')) {
                cleanMessage = 'The server encountered an error. Please try again later.';
            } else if (message.includes('Server error: 502') || message.includes('Server error: 503')) {
                cleanMessage = 'The service is temporarily unavailable. Please try again in a few minutes.';
            } else if (message.includes('Server error: 429')) {
                cleanMessage = 'Too many requests. Please wait a moment and try again.';
            }
            
            // Crypto errors
            else if (message.includes('WebCrypto') || message.includes('crypto')) {
                cleanMessage = 'Encryption is not available. Please ensure you are using a secure connection (HTTPS) or localhost.';
            } else if (message.includes('DOMException')) {
                cleanMessage = 'Encryption failed due to browser security restrictions. Please use HTTPS or localhost.';
            }
            
            // Input validation errors
            else if (message.includes('validation') || message.includes('invalid')) {
                cleanMessage = message; // Keep validation messages as-is since they're already user-friendly
            }
            
            // Remove technical stack traces and error codes
            cleanMessage = cleanMessage.split('\n')[0]; // Take only first line
            cleanMessage = cleanMessage.replace(/Error:\s*/gi, ''); // Remove "Error:" prefix
            cleanMessage = cleanMessage.replace(/TypeError:\s*/gi, ''); // Remove "TypeError:" prefix
            
            return cleanMessage;
        }
        
        // Show temporary notification without changing views
        function showNotification(message, type = 'info', duration = 5000) {
            // Remove existing notifications
            const existingNotifications = document.querySelectorAll('.notification');
            existingNotifications.forEach(n => n.remove());
            
            const notification = document.createElement('div');
            notification.className = `notification alert alert-${type}`;
            notification.style.cssText = `
                position: fixed;
                top: 2rem;
                right: 2rem;
                max-width: 400px;
                z-index: 1000;
                animation: slideIn 0.3s ease-out;
                box-shadow: var(--shadow-lg);
            `;
            notification.textContent = message;
            
            // Add close button
            const closeBtn = document.createElement('button');
            closeBtn.innerHTML = '×';
            closeBtn.style.cssText = `
                position: absolute;
                top: 0.5rem;
                right: 0.5rem;
                background: none;
                border: none;
                font-size: 1.2rem;
                cursor: pointer;
                color: inherit;
                opacity: 0.7;
            `;
            closeBtn.onclick = () => notification.remove();
            notification.appendChild(closeBtn);
            
            document.body.appendChild(notification);
            
            // Auto-remove after duration
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.style.animation = 'slideOut 0.3s ease-in';
                    setTimeout(() => notification.remove(), 300);
                }
            }, duration);
        }
        
        // Network status monitoring
        function initNetworkMonitoring() {
            // Check if online
            function updateNetworkStatus() {
                if (!navigator.onLine) {
                    showNotification('You are offline. Some features may not work.', 'warning', 10000);
                }
            }
            
            window.addEventListener('online', () => {
                showNotification('Connection restored.', 'success', 3000);
            });
            
            window.addEventListener('offline', () => {
                showNotification('You are offline. Some features may not work.', 'warning', 10000);
            });
            
            // Initial check
            updateNetworkStatus();
        }
        
        // Enhanced API error handling
        function handleApiError(response, defaultMessage = 'Server error occurred') {
            const statusCode = response.status;
            
            switch (statusCode) {
                case 400:
                    return 'Invalid request. Please check your input and try again.';
                case 401:
                    return 'Authentication required. Please refresh the page and try again.';
                case 403:
                    return 'Access denied. Please refresh the page and try again.';
                case 404:
                    return 'The requested resource was not found or has expired.';
                case 408:
                    return 'Request timeout. Please try again.';
                case 409:
                    return 'Request conflict. Please refresh and try again.';
                case 410:
                    return 'The requested resource is no longer available.';
                case 413:
                    return 'The request is too large. Please try with less data.';
                case 429:
                    return 'Too many requests. Please wait a moment and try again.';
                case 500:
                    return 'Internal server error. Please try again later.';
                case 502:
                    return 'Bad gateway. The service is temporarily unavailable.';
                case 503:
                    return 'Service unavailable. Please try again in a few minutes.';
                case 504:
                    return 'Gateway timeout. Please try again later.';
                default:
                    return `${defaultMessage} (Error ${statusCode})`;
            }
        }

        function goHome() {
            window.location.hash = '';
            showView('create-view');
        }

        function createAnother() {
            document.getElementById('create-form').reset();
            document.getElementById('password-group').classList.add('hidden');
            showView('create-view');
        }

        // Utility functions
        function copyToClipboard(elementId) {
            const element = document.getElementById(elementId);
            const text = element.textContent;
            
            navigator.clipboard.writeText(text).then(() => {
                const btn = element.parentElement.querySelector('.copy-btn');
                const originalText = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            }).catch(() => {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            });
        }

        function formatDate(timestamp) {
            return new Date(timestamp).toLocaleString();
        }

        // Form handlers
        document.getElementById('use-password').addEventListener('change', function() {
            const passwordGroup = document.getElementById('password-group');
            if (this.checked) {
                passwordGroup.classList.remove('hidden');
            } else {
                passwordGroup.classList.add('hidden');
            }
        });

        // Navigation based on URL hash
        function handleNavigation() {
            const hash = window.location.hash.slice(1);
            
            if (hash.startsWith('s/')) {
                // Secret retrieval - parse URL format: s/{secretId} or s/{secretId}/{encryptionKey}
                const parts = hash.slice(2).split('/');
                const secretId = parts[0];
                const encryptionKey = parts[1]; // undefined for password-protected secrets
                
                showView('retrieve-view');
                retrieveSecret(secretId, encryptionKey);
            } else {
                // Default to create view
                showView('create-view');
            }
        }

        // Helper functions for URL Key vs Password Logic
        
        /**
         * Determine encryption mode from URL
         * @param {string} secretId - The secret ID
         * @param {string} encryptionKey - The encryption key (if present)
         * @returns {Object} Mode information
         */
        function determineEncryptionMode(secretId, encryptionKey) {
            const hasKey = encryptionKey && encryptionKey.trim().length > 0;
            
            return {
                mode: hasKey ? 'key-based' : 'password-based',
                hasKey: hasKey,
                secretId: secretId,
                encryptionKey: encryptionKey,
                description: hasKey 
                    ? 'Key-based encryption (automatic decryption)' 
                    : 'Password-protected (requires password input)'
            };
        }

        /**
         * Validate encryption key format
         * @param {string} key - The encryption key to validate
         * @returns {boolean} True if key appears valid
         */
        function isValidEncryptionKey(key) {
            if (!key || typeof key !== 'string') return false;
            
            // Basic validation - check if it looks like a base64 key
            // Real keys should be base64 encoded and reasonably long
            const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
            return key.length >= 32 && base64Pattern.test(key);
        }

        /**
         * Generate URL for sharing based on encryption mode
         * @param {string} secretId - The secret ID
         * @param {string} encryptionKey - The encryption key (optional)
         * @param {boolean} isPasswordBased - Whether this is password-based encryption
         * @returns {string} The complete shareable URL
         */
        function generateSecretUrl(secretId, encryptionKey = null, isPasswordBased = false) {
            const baseUrl = `${window.location.origin}${window.location.pathname}`;
            
            if (isPasswordBased || !encryptionKey) {
                // Password-protected: just the secret ID
                return `${baseUrl}#s/${secretId}`;
            } else {
                // Key-based: secret ID + encryption key in fragment
                return `${baseUrl}#s/${secretId}/${encryptionKey}`;
            }
        }

        /**
         * Display mode-specific instructions to user
         * @param {Object} modeInfo - Result from determineEncryptionMode
         */
        function showModeInstructions(modeInfo) {
            const instructions = modeInfo.mode === 'key-based' 
                ? 'This secret will be decrypted automatically using the key in the URL.'
                : 'This secret is password-protected. You will need to enter the password to view it.';
            
            showNotification(instructions, 'info', 3000);
        }

        // Secret retrieval function
        async function retrieveSecret(secretId, encryptionKey = null) {
            const statusElement = document.getElementById('retrieve-status');
            const statusText = document.getElementById('retrieve-status-text');
            const passwordPrompt = document.getElementById('password-prompt');
            const secretContent = document.getElementById('secret-content');
            
            // Reset UI state
            statusElement.classList.remove('hidden');
            passwordPrompt.classList.add('hidden');
            secretContent.classList.add('hidden');
            statusText.textContent = 'Retrieving secret...';
            
            try {
                // Validate input and determine encryption mode
                if (!secretId) {
                    throw new Error('No secret ID provided');
                }
                
                const modeInfo = determineEncryptionMode(secretId, encryptionKey);
                console.log('Encryption mode detected:', modeInfo);
                
                // Validate encryption key format if provided
                if (modeInfo.hasKey && !isValidEncryptionKey(encryptionKey)) {
                    throw new Error('The encryption key in the URL appears to be invalid or corrupted.');
                }
                
                if (!cryptoUtils.isWebCryptoAvailable()) {
                    throw new Error('Encryption is not available. Please use HTTPS or localhost.');
                }
                
                // Show mode-specific instructions
                showModeInstructions(modeInfo);
                
                // Call API to retrieve encrypted data
                statusText.textContent = `Retrieving ${modeInfo.mode} secret...`;
                
                const response = await apiCall(`${API_BASE_URL}/api/retrieve`, {
                    method: 'POST',
                    body: JSON.stringify({
                        secretId: secretId
                        // Note: csrfToken will be added automatically by apiCall()
                    })
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    
                    // Handle specific error cases with user-friendly messages
                    if (response.status === 404) {
                        throw new Error('Secret not found. It may have expired or been deleted.');
                    } else if (response.status === 410) {
                        throw new Error('This secret has reached its maximum number of views and has been permanently deleted.');
                    } else {
                        const errorMessage = handleApiError(response, 'Failed to retrieve secret');
                        throw new Error(errorData.error || errorMessage);
                    }
                }
                
                const result = await response.json();
                
                // Parse the stored data structure
                let storedData;
                try {
                    storedData = JSON.parse(result.encryptedData);
                } catch (parseError) {
                    // Fallback for legacy format (if any)
                    storedData = {
                        type: 'key',
                        encryptedData: result.encryptedData
                    };
                }
                
                // Validate that the stored data type matches the URL format
                const expectedType = modeInfo.mode === 'key-based' ? 'key' : 'password';
                if (storedData.type && storedData.type !== expectedType) {
                    const mismatchMessage = storedData.type === 'password' 
                        ? 'This secret is password-protected, but no password was provided. Please use the correct URL format.'
                        : 'This secret uses key-based encryption, but it appears to be accessed as password-protected.';
                    throw new Error(mismatchMessage);
                }
                
                statusText.textContent = 'Decrypting secret...';
                
                // Handle decryption based on encryption type
                if (storedData.type === 'password' || modeInfo.mode === 'password-based') {
                    // Password-protected secret - show password prompt
                    statusElement.classList.add('hidden');
                    passwordPrompt.classList.remove('hidden');
                    
                    // Store data for password decryption
                    window.currentSecretData = {
                        encryptedData: storedData.encryptedData,
                        salt: storedData.salt,
                        viewCount: result.viewCount,
                        maxViews: result.maxViews,
                        isLastView: result.isLastView,
                        createdAt: result.createdAt
                    };
                    
                } else if (storedData.type === 'key' || modeInfo.mode === 'key-based') {
                    // Key-based encryption - decrypt immediately
                    if (!encryptionKey) {
                        throw new Error('This secret requires an encryption key in the URL. The URL may be incomplete or corrupted.');
                    }
                    
                    const decryptedSecret = await decryptSecret(storedData.encryptedData, encryptionKey);
                    
                    // Display the decrypted secret
                    displayDecryptedSecret(decryptedSecret, result);
                    
                } else {
                    throw new Error('Unknown encryption type in stored data');
                }
                
            } catch (error) {
                console.error('Secret retrieval failed:', error);
                statusElement.classList.add('hidden');
                showError(`Failed to retrieve secret: ${error.message}`);
            }
        }
        
        // Helper function to display decrypted secret
        function displayDecryptedSecret(decryptedText, metaData) {
            const statusElement = document.getElementById('retrieve-status');
            const secretContent = document.getElementById('secret-content');
            
            // Hide status, show content
            statusElement.classList.add('hidden');
            secretContent.classList.remove('hidden');
            
            // Display the secret
            document.getElementById('decrypted-secret').textContent = decryptedText;
            
            // Display metadata
            document.getElementById('view-count').textContent = metaData.viewCount;
            document.getElementById('views-remaining').textContent = metaData.maxViews - metaData.viewCount;
            
            // Show last view warning if applicable
            const lastViewWarning = document.getElementById('last-view-warning');
            if (metaData.isLastView) {
                lastViewWarning.classList.remove('hidden');
            } else {
                lastViewWarning.classList.add('hidden');
            }
        }

        async function decryptWithPassword() {
            const btn = document.querySelector('#password-prompt button');
            const spinner = document.getElementById('decrypt-spinner');
            const text = document.getElementById('decrypt-text');
            const passwordInput = document.getElementById('decrypt-password');
            
            // UI state: loading
            btn.disabled = true;
            spinner.classList.remove('hidden');
            text.textContent = 'Decrypting...';
            
            try {
                // Validate input
                const password = passwordInput.value.trim();
                if (!password) {
                    throw new Error('Please enter a password');
                }
                
                // Check if we have the secret data stored from retrieval
                if (!window.currentSecretData) {
                    throw new Error('No secret data available. Please refresh and try again.');
                }
                
                if (!cryptoUtils.isWebCryptoAvailable()) {
                    throw new Error('Encryption is not available. Please use HTTPS or localhost.');
                }
                
                const secretData = window.currentSecretData;
                
                // Decrypt the secret using the password and stored salt
                const decryptedSecret = await decryptSecretWithPassword(
                    secretData.encryptedData,
                    password,
                    secretData.salt
                );
                
                // Clear the stored data for security
                window.currentSecretData = null;
                
                // Clear the password input for security
                passwordInput.value = '';
                
                // Display the decrypted secret
                displayDecryptedSecret(decryptedSecret, secretData);
                
                // Reset UI state
                btn.disabled = false;
                spinner.classList.add('hidden');
                text.textContent = 'Decrypt Secret';
                
            } catch (error) {
                console.error('Password decryption failed:', error);
                
                // Reset UI state
                btn.disabled = false;
                spinner.classList.add('hidden');
                text.textContent = 'Decrypt Secret';
                
                // Show error message
                let errorMessage = error.message;
                
                // Provide more user-friendly error messages for common cases
                if (error.message.includes('Decryption failed') || error.message.includes('Invalid key')) {
                    errorMessage = 'Incorrect password. Please check your password and try again.';
                } else if (error.message.includes('corrupted data')) {
                    errorMessage = 'The secret data appears to be corrupted.';
                }
                
                // Display error in the password prompt area
                showPasswordError(errorMessage);
            }
        }
        
        // Helper function to show error in password prompt
        function showPasswordError(message) {
            // Remove any existing error alerts
            const existingAlert = document.querySelector('#password-prompt .alert-danger');
            if (existingAlert) {
                existingAlert.remove();
            }
            
            // Create error alert
            const errorAlert = document.createElement('div');
            errorAlert.className = 'alert alert-danger';
            errorAlert.style.marginTop = '1rem';
            errorAlert.textContent = message;
            
            // Insert after the password input group
            const passwordGroup = document.querySelector('#password-prompt .form-group');
            passwordGroup.parentNode.insertBefore(errorAlert, passwordGroup.nextSibling);
            
            // Remove error after 10 seconds
            setTimeout(() => {
                if (errorAlert.parentElement) {
                    errorAlert.remove();
                }
            }, 10000);
        }

        document.getElementById('create-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const btn = this.querySelector('button[type="submit"]');
            const spinner = document.getElementById('create-spinner');
            const text = document.getElementById('create-text');
            const status = document.getElementById('create-status');
            
            // UI state: loading
            btn.disabled = true;
            spinner.classList.remove('hidden');
            text.textContent = 'Creating...';
            status.classList.remove('hidden');
            document.getElementById('create-status-text').textContent = 'Encrypting secret...';
            
            try {
                // Get form data
                const secretText = document.getElementById('secret-text').value.trim();
                const maxViews = parseInt(document.getElementById('max-views').value);
                const expirationHours = parseInt(document.getElementById('expiration').value);
                const usePassword = document.getElementById('use-password').checked;
                const userPassword = document.getElementById('password').value.trim();
                
                // Validate form data
                if (!secretText) {
                    throw new Error('Please enter a secret message');
                }
                
                if (!cryptoUtils.isWebCryptoAvailable()) {
                    throw new Error('Encryption is not available. Please use HTTPS or localhost.');
                }
                
                // Determine encryption method and encrypt the secret
                let encryptedData, encryptionKey, passwordData;
                
                document.getElementById('create-status-text').textContent = 'Encrypting secret...';
                
                if (usePassword) {
                    // Password-based encryption
                    const password = userPassword || cryptoUtils.generatePassword(16);
                    if (!userPassword) {
                        passwordData = { generatedPassword: password }; // Store for display later
                    }
                    
                    const result = await encryptSecretWithPassword(secretText, password);
                    // Combine encrypted data and salt into a single string for storage
                    encryptedData = JSON.stringify({
                        type: 'password',
                        encryptedData: result.encryptedData,
                        salt: result.salt
                    });
                } else {
                    // Key-based encryption (stored in URL)
                    const result = await encryptSecret(secretText);
                    encryptedData = JSON.stringify({
                        type: 'key',
                        encryptedData: result.encryptedData
                    });
                    encryptionKey = result.key;
                }
                
                // Prepare API request
                document.getElementById('create-status-text').textContent = 'Storing secret securely...';
                
                const requestData = {
                    encryptedData: encryptedData,
                    maxViews: maxViews,
                    expirationHours: expirationHours,
                    // Note: csrfToken will be added automatically by apiCall()
                };
                
                // Call the API
                const response = await apiCall(`${API_BASE_URL}/api/create`, {
                    method: 'POST',
                    body: JSON.stringify(requestData)
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const errorMessage = handleApiError(response, 'Failed to create secret');
                    throw new Error(errorData.error || errorMessage);
                }
                
                const result = await response.json();
                
                // Generate the complete URL using helper function
                const secretUrl = generateSecretUrl(result.secretId, encryptionKey, usePassword);
                
                // Display success
                document.getElementById('secret-url').textContent = secretUrl;
                document.getElementById('success-max-views').textContent = maxViews.toString();
                document.getElementById('success-expires').textContent = formatDate(result.expiresAt);
                
                // Show mode-specific success message
                const modeMessage = usePassword 
                    ? 'Password-protected secret created. Share the URL and provide the password separately for maximum security.'
                    : 'Key-based secret created. The encryption key is embedded in the URL for convenient sharing.';
                showNotification(modeMessage, 'success', 7000);
                
                // Handle password display
                const passwordInfo = document.getElementById('password-info');
                if (passwordData && passwordData.generatedPassword) {
                    document.getElementById('generated-password').textContent = passwordData.generatedPassword;
                    passwordInfo.classList.remove('hidden');
                } else {
                    passwordInfo.classList.add('hidden');
                }
                
                // Reset UI and show success
                btn.disabled = false;
                spinner.classList.add('hidden');
                text.textContent = 'Create Secret Link';
                status.classList.add('hidden');
                
                showView('success-view');
                
            } catch (error) {
                console.error('Secret creation failed:', error);
                
                // Reset UI
                btn.disabled = false;
                spinner.classList.add('hidden');
                text.textContent = 'Create Secret Link';
                status.classList.add('hidden');
                
                // Show error
                showError(`Failed to create secret: ${error.message}`);
            }
        });

        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            initTheme();
            handleNavigation();
            initNetworkMonitoring();
        });

        window.addEventListener('hashchange', handleNavigation);