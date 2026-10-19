-- Run this against your remote D1 database to update passwords
-- Each user gets a simple password: <username>123

UPDATE users SET password_hash = 'pbkdf2_sha256$100000$uV1suxqn2Xq3xRLfyHI0jQ==$qB9XJc73+hja+w7C69AKJCfkUZmIJkEU82PA6W33z7k=' WHERE username = 'directorate';
UPDATE users SET password_hash = 'pbkdf2_sha256$100000$jPyu9pqWWOsed0f6IxtXTQ==$wav5sVjkQvqiUkqN38cGjT+2I8GAoSFALd6pUL1btGI=' WHERE username = 'secretary';
UPDATE users SET password_hash = 'pbkdf2_sha256$100000$dUqiV0T02by3yFrctr/K6w==$IYHEtwbzyHXHS9YRxfubIMIcqKOfaY7CVZHbXVaDwZY=' WHERE username = 'chairman';
UPDATE users SET password_hash = 'pbkdf2_sha256$100000$+V+XuuKq6C16SnUx64cBaA==$8hXhiQTi0j7xSoINgzZoNN2gmT5NYk+pJhvkk9yRO/Y=' WHERE username = 'Ihpau';
UPDATE users SET password_hash = 'pbkdf2_sha256$100000$+zE60tvuzTAhowrbdWX8dw==$cTtAcy9FRqjjFNO1NG+g1WAyQ7DwP9J2oUZQ/xXyT1g=' WHERE username = 'admin';
