# VS Code open source (openvscode-server) para o Vault e os projetos. Só o yui-console alcança este
# container (rede interna, sem Traefik); o console checa a sessão e repassa /code.
FROM gitpod/openvscode-server@sha256:5e7b8750749f282940a799ed59ccd02fac698ef6744f9113ac01c0ef8e76485e
USER openvscode-server
RUN ${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server --install-extension foam.foam-vscode \
 && mkdir -p /home/workspace/.openvscode-server/data/Machine
COPY --chown=openvscode-server:openvscode-server yui-bridge ${OPENVSCODE_SERVER_ROOT}/extensions/yui-bridge
COPY --chown=openvscode-server:openvscode-server settings.json /home/workspace/.openvscode-server/data/Machine/settings.json
ENTRYPOINT ["/bin/sh", "-c", "exec ${OPENVSCODE_SERVER_ROOT}/bin/openvscode-server --host 0.0.0.0 --port 3000 --without-connection-token --server-base-path /code --default-workspace /workspace/.yui/yui.code-workspace \"$@\"", "--"]
