#!/bin/bash
# Skrip untuk mengembalikan seluruh kode ke kondisi sebelum pembaruan Zero-Cache
echo "Memulai proses restore checkpoint..."
cp -r .backup_checkpoints/checkpoint_before_zero_cache/server.ts ./server.ts
cp -r .backup_checkpoints/checkpoint_before_zero_cache/package.json ./package.json
cp -r .backup_checkpoints/checkpoint_before_zero_cache/src/* ./src/
echo "Restore checkpoint berhasil 100%!"
