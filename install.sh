#!/bin/bash

# Script de instalación para Debian - HTB MeetUp Payment Gateway
# Este script instala Docker, Docker Compose, Node.js y despliega los retos.

# Colores para la salida
GREEN='\033[0-1;32m'
BLUE='\033[0-1;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}[*] Actualizando el sistema...${NC}"
sudo apt-get update && sudo apt-get upgrade -y

echo -e "${BLUE}[*] Instalando dependencias básicas...${NC}"
sudo apt-get install -y ca-certificates curl gnupg lsb-release build-essential

# 1. Instalar Docker y Docker Compose
echo -e "${BLUE}[*] Instalando Docker y Docker Compose...${NC}"
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo 
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian 
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | 
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 2. Instalar Node.js (NodeSource - Versión 20 LTS)
echo -e "${BLUE}[*] Instalando Node.js 20...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Verificar instalaciones
echo -e "${GREEN}[+] Verificando versiones:${NC}"
docker --version
docker compose version
node --version
npm --version

# 4. Desplegar los retos con Docker Compose
echo -e "${BLUE}[*] Desplegando los retos...${NC}"
# Asegurarnos de estar en el directorio correcto (donde está el script)
cd "$(dirname "$0")"

# Construir e iniciar contenedores
sudo docker compose up -d --build

echo -e "${GREEN}===========================================${NC}"
echo -e "${GREEN}  ¡Despliegue completado con éxito!        ${NC}"
echo -e "${GREEN}===========================================${NC}"
echo -e "Level 1: http://localhost:3001"
echo -e "Level 2: http://localhost:3002"
echo -e "Level 3: http://localhost:3003"
echo -e "${BLUE}Puedes ver los logs con: sudo docker compose logs -f${NC}"
