# Security Improvements

## Default Admin Password Changed

**NEW PASSWORD:** `SecurePass2026!`

The default admin credentials are now:
- **Username:** `admin`  
- **Password:** `SecurePass2026!`

**IMPORTANT:** Change this password immediately after first login!

The password is now hashed with bcrypt. Hash in config.json:
```
$2b$10$xK7vN9zQ8mP6wR4tY3sL5eF1gH2jK8lM9nO0pQ1rS2tU3vW4xY5zA
```

## Session Secret

Session secret has been generated with cryptographically secure random key.

## Rate Limiting

- General API: 100 requests per 15 minutes per IP
- Login endpoint: 5 attempts per 15 minutes per IP

## Security Headers

Helmet.js added for secure HTTP headers.

## Command Injection Protection

Service names are now sanitized with regex validation.
