package github

import (
	"github.com/actions/actions-runner-controller/github/actions"
	"github.com/go-logr/logr"
)

type SessionRefreshingClient struct {
	client  actions.ActionsService
	logger  logr.Logger
	session *actions.RunnerScaleSetSession
}
