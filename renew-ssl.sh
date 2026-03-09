#!/bin/bash

# SSL Certificate Renewal Script for Docker
# This script renews Let's Encrypt certificates and reloads nginx

cd /home/ubuntu/portfolio
docker compose -f docker-compose.prod.yml stop nginx

certbot renew --quiet

cp /etc/letsencrypt/live/alanbignon.com/fullchain.pem ssl/
cp /etc/letsencrypt/live/alanbignon.com/privkey.pem ssl/
chown ubuntu:ubuntu ssl/*.pem

docker compose -f docker-compose.prod.yml start nginx-docker

echo "$(date): SSL renewal attempted" >> /var/log/ssl-renewal.log
