#!/bin/bash
# Levanta los servidores locales de AGI (API + frontend en 8080 y 3001)
# Uso: ./iniciar.sh

cd "$(dirname "$0")"

# Detener instancias previas si existen
screen -S api8080 -X quit 2>/dev/null
screen -S api3001 -X quit 2>/dev/null
sleep 1

# Levantar ambos puertos
screen -dmS api8080 bash -c 'PORT=8080 node apps/api/src/index.js > /tmp/api8080.log 2>&1'
screen -dmS api3001 bash -c 'PORT=3001 node apps/api/src/index.js > /tmp/api3001.log 2>&1'

sleep 3
echo "AGI corriendo:"
echo "  http://localhost:8080"
echo "  http://localhost:3001"
echo ""
echo "Para detener: screen -S api8080 -X quit && screen -S api3001 -X quit"
echo "Logs: tail -f /tmp/api8080.log"
