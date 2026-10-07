# VS Code open source (openvscode-server) para o Vault e os projetos. Só o serviço atria alcança este
# container (rede interna, sem Traefik); o Atria OS checa a sessão e repassa /code.
FROM gitpod/openvscode-server@sha256:5e7b8750749f282940a799ed59ccd02fac698ef6744f9113ac01c0ef8e76485e
USER openvscode-server
RUN ${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server --install-extension foam.foam-vscode \
 && mkdir -p /home/workspace/.openvscode-server/data/Machine /home/workspace/.openvscode-server/data/User
COPY --chown=openvscode-server:openvscode-server atria-bridge ${OPENVSCODE_SERVER_ROOT}/extensions/atria-bridge
# mesmas configurações como Machine e User (algumas, como confiança do workspace, só valem no escopo do usuário)
COPY --chown=openvscode-server:openvscode-server settings.json /home/workspace/.openvscode-server/data/Machine/settings.json
COPY --chown=openvscode-server:openvscode-server settings.json /home/workspace/.openvscode-server/data/User/settings.json
ENTRYPOINT ["/bin/sh", "-c", "exec ${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server --host 0.0.0.0 --port 3000 --without-connection-token --server-base-path /code --default-workspace /workspace/.atria/atria.code-workspace \"$@\"", "--"]
