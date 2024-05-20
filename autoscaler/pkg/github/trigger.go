package github

type TriggerHandler interface {
	CurrentRunnerCount() (int, error)
	TriggerNewRunners(count int) error
	NeededRunners(count int) error
}
