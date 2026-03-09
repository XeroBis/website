#!/bin/bash

# SSL Certificate Renewal Script for Docker
# This script renews Let's Encrypt certificates and reloads nginx

cd /home/ubuntu/portfolio

# Stop nginx container to free port 80 for Certbot
docker compose -f docker-compose.prod.yml stop nginx

# Renew certificates
certbot renew --quiet

# Copy renewed certificates to local ssl directory
cp /etc/letsencrypt/live/alanbignon.com/fullchain.pem ssl/
cp /etc/letsencrypt/live/alanbignon.com/privkey.pem ssl/
chown ubuntu:ubuntu ssl/*.pem

# Restart nginx container to pick up renewed certificates
docker compose -f docker-compose.prod.yml start nginx-docker

# Log renewal attempt
echo "$(date): SSL renewal attempted" >> /var/log/ssl-renewal.log
